import { useEffect, useState } from "react";
import api from "@/lib/api";

export function useProjectTowers(initialProject = "", initialBlock = "") {
  const [projects, setProjects] = useState([]);
  const [towers, setTowers] = useState([]);
  const [projectId, setProjectId] = useState(initialProject || "");
  const [blockId, setBlockId] = useState(initialBlock || "");
  useEffect(() => { api.get("/projects?page_size=200").then((r) => setProjects(r.data.items || r.data)).catch(() => {}); }, []);
  useEffect(() => { if (!projectId) { setTowers([]); return; } api.get(`/blocks?project_id=${projectId}&page_size=200`).then((r) => setTowers(r.data.items || r.data)).catch(() => setTowers([])); }, [projectId]);
  const addProject = (p) => { setProjects((a) => [...a, p]); setProjectId(p.id); setBlockId(""); };
  const addTower = (t) => { setTowers((a) => [...a, t]); setBlockId(t.id); };
  return { projects, towers, projectId, setProjectId, blockId, setBlockId, addProject, addTower };
}
