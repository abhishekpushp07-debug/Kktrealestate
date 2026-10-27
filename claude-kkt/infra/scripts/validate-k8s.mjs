// Semantic checks of infra/k8s that schema validation (kubeconform) cannot do. Run: node infra/scripts/validate-k8s.mjs [dir]
//  - every document parses and has apiVersion/kind/metadata.name, namespace kkt for namespaced kinds
//  - Deployment/Job selectors match their pod template labels; Services, PDBs, HPAs and NetworkPolicies point at existing workloads
//  - named probe/service ports exist on the container; envFrom ConfigMaps exist; every *_FILE path under /run/secrets/kkt names a key
//    of the kkt-secrets template; mounted Secrets/ConfigMaps exist
//  - every container runs as non-root, drops all capabilities, forbids privilege escalation and sets CPU/memory requests and limits
//  - the api Deployment probes: readiness /api/v1/health/ready, liveness and startup /api/v1/health/live (never the full /api/v1/health,
//    which answers 503 when a dependency is down and would restart every replica)
//  - images: no tag in the workloads (kustomize sets the immutable git-SHA tag), every kkt image is listed in kustomization.yaml, and no
//    ":latest" / "newTag: latest" anywhere
//  - the worker (contract C8): ≥ 2 replicas, startup/readiness/liveness httpGet /health on container port 9465, a grace period of at
//    least WORKER_DRAIN_TIMEOUT_MS + 30 s, a PodDisruptionBudget, and a liveness window longer than the grace period
//  - every API/worker/migrate container gets the contract C9 key rings (JWT_SIGNING_KEYS, LINK_SIGNING_KEYS, HASH_KEYS) as _FILE secrets
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";

const dir = process.argv[2] ?? "infra/k8s";
const docs = [];
for (const f of readdirSync(dir)
  .filter((n) => n.endsWith(".yaml") && n !== "kustomization.yaml")
  .sort()) {
  for (const d of parseAllDocuments(readFileSync(join(dir, f), "utf8"))) {
    if (d.errors.length) throw new Error(`${f}: ${d.errors.map((e) => e.message).join("; ")}`);
    const obj = d.toJS();
    if (obj) docs.push({ file: f, obj });
  }
}
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const byKind = (k) => docs.filter((d) => d.obj.kind === k);
const find = (k, name) => docs.find((d) => d.obj.kind === k && d.obj.metadata?.name === name);
const matches = (selector, labels) => Object.entries(selector ?? {}).every(([k, v]) => labels?.[k] === v);
const exprMatches = (exprs, labels) =>
  (exprs ?? []).every((e) =>
    e.operator === "In"
      ? e.values.includes(labels?.[e.key])
      : e.operator === "NotIn"
        ? !e.values.includes(labels?.[e.key])
        : e.operator === "Exists"
          ? labels?.[e.key] !== undefined
          : labels?.[e.key] === undefined,
  );
const selects = (sel, labels) =>
  matches(sel?.matchLabels ?? (sel && !sel.matchExpressions && !sel.matchLabels ? sel : {}), labels) &&
  exprMatches(sel?.matchExpressions, labels);

const kustom = parseAllDocuments(readFileSync(join(dir, "kustomization.yaml"), "utf8"))[0].toJS();
for (const r of kustom.resources)
  if (!readdirSync(dir).includes(r)) fail("kustomization.yaml", `resource ${r} does not exist`);
const listed = new Set(kustom.resources);
for (const f of new Set(docs.map((d) => d.file)))
  if (!listed.has(f) && f !== "secret.example.yaml") fail("kustomization.yaml", `${f} is not listed`);

const secretKeys = new Set(Object.keys(find("Secret", "kkt-secrets")?.obj.stringData ?? {}));
if (secretKeys.size === 0) fail("secret.example.yaml", "kkt-secrets template missing");

for (const { file, obj } of docs) {
  const where = `${file} ${obj.kind}/${obj.metadata?.name}`;
  if (!obj.apiVersion || !obj.kind || !obj.metadata?.name) fail(where, "apiVersion/kind/metadata.name required");
  if (obj.kind !== "Namespace" && obj.metadata?.namespace !== "kkt") fail(where, "namespace must be kkt");
}

const workloads = [...byKind("Deployment"), ...byKind("Job")];
for (const { file, obj } of workloads) {
  const where = `${file} ${obj.kind}/${obj.metadata.name}`;
  const tpl = obj.spec.template;
  const labels = tpl.metadata?.labels ?? {};
  if (obj.kind === "Deployment" && !selects(obj.spec.selector, labels))
    fail(where, "selector does not match template labels");
  const pod = tpl.spec;
  if (pod.securityContext?.runAsNonRoot !== true) fail(where, "pod securityContext.runAsNonRoot must be true");
  if (pod.securityContext?.seccompProfile?.type !== "RuntimeDefault")
    fail(where, "seccompProfile RuntimeDefault required");
  const volumes = new Map((pod.volumes ?? []).map((v) => [v.name, v]));
  for (const v of volumes.values()) {
    if (v.secret && !find("Secret", v.secret.secretName))
      fail(where, `volume ${v.name}: Secret ${v.secret.secretName} not defined`);
    if (v.configMap && !find("ConfigMap", v.configMap.name))
      fail(where, `volume ${v.name}: ConfigMap ${v.configMap.name} not defined`);
    for (const it of v.secret?.items ?? [])
      if (!secretKeys.has(it.key)) fail(where, `volume ${v.name}: secret key ${it.key} missing from the template`);
  }
  for (const c of pod.containers) {
    const cw = `${where} container ${c.name}`;
    const sc = c.securityContext ?? {};
    if (sc.allowPrivilegeEscalation !== false) fail(cw, "allowPrivilegeEscalation must be false");
    if (!sc.capabilities?.drop?.includes("ALL")) fail(cw, "capabilities.drop must include ALL");
    for (const k of ["cpu", "memory"]) {
      if (!c.resources?.requests?.[k]) fail(cw, `resources.requests.${k} missing`);
      if (!c.resources?.limits?.[k]) fail(cw, `resources.limits.${k} missing`);
    }
    const portNames = new Set((c.ports ?? []).map((p) => p.name));
    for (const probe of ["readinessProbe", "livenessProbe", "startupProbe"]) {
      const port = c[probe]?.httpGet?.port ?? c[probe]?.tcpSocket?.port;
      if (typeof port === "string" && !portNames.has(port)) fail(cw, `${probe} uses unknown port ${port}`);
    }
    for (const ef of c.envFrom ?? [])
      if (ef.configMapRef && !find("ConfigMap", ef.configMapRef.name))
        fail(cw, `envFrom ConfigMap ${ef.configMapRef.name} not defined`);
    const mounts = new Map((c.volumeMounts ?? []).map((m) => [m.mountPath, m]));
    for (const m of mounts.values()) if (!volumes.has(m.name)) fail(cw, `volumeMount ${m.name} has no volume`);
    for (const e of c.env ?? []) {
      if (e.name.endsWith("_FILE") && typeof e.value === "string" && e.value.startsWith("/run/secrets/kkt/")) {
        const key = e.value.slice("/run/secrets/kkt/".length);
        if (!secretKeys.has(key)) fail(cw, `${e.name} → ${key} is not a key of kkt-secrets`);
        if (!mounts.has("/run/secrets/kkt")) fail(cw, `${e.name} needs the secret mounted at /run/secrets/kkt`);
      }
      if (e.valueFrom?.resourceFieldRef && e.valueFrom.resourceFieldRef.containerName !== c.name)
        fail(cw, `${e.name}: resourceFieldRef must name this container`);
    }
  }
}

const api = find("Deployment", "api")?.obj.spec.template.spec.containers[0];
if (api?.readinessProbe?.httpGet?.path !== "/api/v1/health/ready")
  fail("api.yaml", "readiness probe must be /api/v1/health/ready");
if (api?.livenessProbe?.httpGet?.path !== "/api/v1/health/live")
  fail("api.yaml", "liveness probe must be /api/v1/health/live (dependency-free)");
if (api?.startupProbe && api.startupProbe.httpGet?.path !== "/api/v1/health/live")
  fail("api.yaml", "startup probe must be /api/v1/health/live");

// images: immutable tags come from kustomize (the deploy workflow sets the git SHA); never a moving tag
const kustomImages = new Map((kustom.images ?? []).map((i) => [i.name, i]));
for (const [name, i] of kustomImages)
  if (!i.newTag || i.newTag === "latest" || i.digest === "latest")
    fail("kustomization.yaml", `image ${name} needs an explicit newTag (not latest)`);
for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")))
  if (/:latest\b(?!\))/.test(readFileSync(join(dir, f), "utf8").replace(/^\s*#.*$/gm, ""))) fail(f, 'uses ":latest"');
for (const { file, obj } of workloads)
  for (const c of obj.spec.template.spec.containers) {
    const [repo, tag] = c.image.split(/:(?=[^/]+$)/);
    if (repo.startsWith("kkt-")) {
      if (tag)
        fail(`${file} ${c.name}`, `image ${c.image}: leave the tag to kustomize (images: in kustomization.yaml)`);
      if (!kustomImages.has(repo))
        fail(`${file} ${c.name}`, `image ${repo} is not listed under images: in kustomization.yaml`);
    } else if (!tag) fail(`${file} ${c.name}`, `third-party image ${c.image} needs a pinned tag`);
  }

// the job worker (contract C8)
const config = find("ConfigMap", "kkt-config")?.obj.data ?? {};
const workerDep = find("Deployment", "worker")?.obj;
if (!workerDep) fail("worker.yaml", "worker Deployment missing");
else {
  const pod = workerDep.spec.template.spec;
  const c = pod.containers[0];
  if ((workerDep.spec.replicas ?? 1) < 2) fail("worker.yaml", "run at least 2 worker replicas");
  const healthPort = (c.ports ?? []).find((p) => p.containerPort === 9465);
  if (!healthPort) fail("worker.yaml", "the worker must expose its C8 health port 9465");
  for (const probe of ["startupProbe", "readinessProbe", "livenessProbe"]) {
    const g = c[probe]?.httpGet;
    if (!g || g.path !== "/health" || (g.port !== 9465 && g.port !== healthPort?.name))
      fail("worker.yaml", `${probe} must be httpGet /health on port 9465`);
  }
  const drainMs = Number(config.WORKER_DRAIN_TIMEOUT_MS ?? 120000);
  const grace = pod.terminationGracePeriodSeconds ?? 30;
  if (grace < drainMs / 1000 + 30)
    fail(
      "worker.yaml",
      `terminationGracePeriodSeconds ${grace} < WORKER_DRAIN_TIMEOUT_MS/1000 + 30 (${drainMs / 1000 + 30})`,
    );
  const l = c.livenessProbe ?? {};
  if ((l.periodSeconds ?? 10) * (l.failureThreshold ?? 3) <= grace)
    fail("worker.yaml", "the liveness failure window must exceed the grace period (a draining worker answers 503)");
  if (!byKind("PodDisruptionBudget").some((d) => selects(d.obj.spec.selector, workerDep.spec.template.metadata.labels)))
    fail("worker.yaml", "the worker needs a PodDisruptionBudget");
}

// key rings (contract C9) wherever the API's configuration is loaded
for (const name of ["api", "worker", "migrate"]) {
  const w = find("Deployment", name) ?? find("Job", name);
  const c = w?.obj.spec.template.spec.containers[0];
  if (!c) continue;
  const env = new Set((c.env ?? []).map((e) => e.name));
  for (const ring of ["JWT_SIGNING_KEYS", "LINK_SIGNING_KEYS", "HASH_KEYS"])
    if (!env.has(`${ring}_FILE`))
      fail(`${w.file} ${name}`, `${ring}_FILE missing (required in production, contract C9)`);
}

const podLabels = workloads.map((w) => w.obj.spec.template.metadata.labels);
for (const { file, obj } of byKind("Service")) {
  if (obj.spec.type === "ExternalName") continue;
  const target = workloads.find((w) =>
    selects({ matchLabels: obj.spec.selector }, w.obj.spec.template.metadata.labels),
  );
  if (!target) {
    fail(`${file} Service/${obj.metadata.name}`, "selects no workload");
    continue;
  }
  const ports = new Set(target.obj.spec.template.spec.containers.flatMap((c) => (c.ports ?? []).map((p) => p.name)));
  for (const p of obj.spec.ports)
    if (typeof p.targetPort === "string" && !ports.has(p.targetPort))
      fail(`${file} Service/${obj.metadata.name}`, `targetPort ${p.targetPort} not on the pods`);
}
for (const { file, obj } of byKind("PodDisruptionBudget"))
  if (!podLabels.some((l) => selects(obj.spec.selector, l)))
    fail(`${file} PDB/${obj.metadata.name}`, "selects no pods");
for (const { file, obj } of byKind("HorizontalPodAutoscaler")) {
  const t = find(obj.spec.scaleTargetRef.kind, obj.spec.scaleTargetRef.name);
  if (!t) fail(`${file} HPA/${obj.metadata.name}`, "scale target missing");
  else if (!t.obj.spec.template.spec.containers.every((c) => c.resources?.requests?.cpu))
    fail(`${file} HPA/${obj.metadata.name}`, "CPU utilisation needs CPU requests");
}
for (const { file, obj } of byKind("NetworkPolicy"))
  if (Object.keys(obj.spec.podSelector).length && !podLabels.some((l) => selects(obj.spec.podSelector, l)))
    fail(`${file} NetworkPolicy/${obj.metadata.name}`, "selects no pods");
for (const { file, obj } of byKind("Ingress")) {
  for (const rule of obj.spec.rules)
    for (const p of rule.http.paths) {
      const svc = find("Service", p.backend.service.name);
      if (!svc) fail(`${file} Ingress ${rule.host}${p.path}`, `Service ${p.backend.service.name} missing`);
      else if (
        !svc.obj.spec.ports.some(
          (sp) => sp.name === p.backend.service.port.name || sp.port === p.backend.service.port.number,
        )
      )
        fail(`${file} Ingress ${rule.host}${p.path}`, "service port missing");
    }
}

if (errors.length) {
  console.error(`k8s validation failed (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  process.exit(1);
}
console.log(`k8s manifests OK: ${docs.length} objects in ${new Set(docs.map((d) => d.file)).size} files`);
