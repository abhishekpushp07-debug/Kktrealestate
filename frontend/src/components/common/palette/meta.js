import { Building2, Database, Home, Layers, Users } from "lucide-react";

export const ICON = { projects: Building2, blocks: Layers, flats: Home, users: Users, flat_types: Database };
export const LABEL = { projects: "Projects", blocks: "Blocks", flats: "Flats", users: "Users", flat_types: "Flat types" };
export const href = (type, x) => type === "projects" ? `/projects/${x.id}` : type === "blocks" ? `/blocks/${x.id}` : type === "flats" ? `/blocks/${x.block_id}?flat=${x.id}` : type === "users" ? "/users" : "/master/flat-types";
