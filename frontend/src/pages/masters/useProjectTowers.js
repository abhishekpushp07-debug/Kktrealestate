import { useEffect, useState } from "react";
import api from "@/lib/api";

export function useProjectTowers(initialProject = "", initialBlock = "") {
  const [projects, setProjects] = useState([]);
  const [towers, setTowers] = useState([]);
  const [projectId, setProjectId] = useState(initialProject || "");
  const [blockId, setBlockId] = useState(initialBlock || "");
  useEffect(() => { api.get("/projects?limit=200").then((r) => setProjects(r.data.items || r.data)).catch(() => {}); }, []);
  useEffect(() => { if (!projectId) { setTowers([]); return; } api.get(`/blocks?project_id=${projectId}&limit=200`).then((r) => setTowers(r.data.items || r.data)).catch(() => setTowers([])); }, [projectId]);
  return { projects, towers, projectId, setProjectId, blockId, setBlockId };
}
