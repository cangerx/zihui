import { create } from "zustand";
import { canvasAPI } from "@/lib/api";

export interface CanvasProject {
  id: number | null;        // null = local-only (not yet saved to server)
  localKey: string;         // localStorage key suffix
  name: string;
  thumbnail: string;
  nodeCount: number;
  updatedAt: string;
  dirty: boolean;           // has unsaved changes
}

interface CanvasProjectsState {
  projects: CanvasProject[];
  activeKey: string;        // localKey of the active canvas
  loaded: boolean;

  fetchList: () => Promise<void>;
  createProject: (name?: string) => CanvasProject;
  renameProject: (localKey: string, name: string) => void;
  removeProject: (localKey: string) => Promise<void>;
  switchTo: (localKey: string) => void;
  markDirty: (localKey: string) => void;
  saveToServer: (localKey: string, nodes: any[]) => Promise<void>;
  updateNodeCount: (localKey: string, count: number) => void;
  updateThumbnail: (localKey: string, thumbnail: string) => void;
}

let nextLocalId = 1;

function genLocalKey(): string {
  return `local-${Date.now()}-${nextLocalId++}`;
}

export const useCanvasProjects = create<CanvasProjectsState>((set, get) => ({
  projects: [],
  activeKey: "default",
  loaded: false,

  fetchList: async () => {
    try {
      const res = await canvasAPI.list();
      const serverList: any[] = res.data?.data ?? [];

      const existing = get().projects;
      const localOnly = existing.filter((p) => p.id === null);

      const serverProjects: CanvasProject[] = serverList.map((s) => ({
        id: s.id,
        localKey: `server-${s.id}`,
        name: s.name,
        thumbnail: s.thumbnail || "",
        nodeCount: s.node_count || 0,
        updatedAt: s.updated_at,
        dirty: false,
      }));

      // Ensure there's always a "default" project
      const all = [...localOnly, ...serverProjects];
      if (all.length === 0) {
        all.push({
          id: null,
          localKey: "default",
          name: "默认画布",
          thumbnail: "",
          nodeCount: 0,
          updatedAt: new Date().toISOString(),
          dirty: false,
        });
      }

      // If activeKey doesn't exist in list, switch to first
      const activeKey = get().activeKey;
      const hasActive = all.some((p) => p.localKey === activeKey);

      set({
        projects: all,
        loaded: true,
        activeKey: hasActive ? activeKey : all[0].localKey,
      });
    } catch {
      // If not logged in or network error, ensure default project exists
      const existing = get().projects;
      if (existing.length === 0) {
        set({
          projects: [{
            id: null,
            localKey: "default",
            name: "默认画布",
            thumbnail: "",
            nodeCount: 0,
            updatedAt: new Date().toISOString(),
            dirty: false,
          }],
          loaded: true,
        });
      }
    }
  },

  createProject: (name?: string) => {
    const localKey = genLocalKey();
    const project: CanvasProject = {
      id: null,
      localKey,
      name: name || `画布 ${get().projects.length + 1}`,
      thumbnail: "",
      nodeCount: 0,
      updatedAt: new Date().toISOString(),
      dirty: false,
    };
    set((s) => ({
      projects: [...s.projects, project],
      activeKey: localKey,
    }));
    return project;
  },

  renameProject: (localKey, name) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.localKey === localKey ? { ...p, name, dirty: true } : p
      ),
    }));
    // If saved to server, update name immediately
    const project = get().projects.find((p) => p.localKey === localKey);
    if (project?.id) {
      canvasAPI.update(project.id, { name }).catch(() => {});
    }
  },

  removeProject: async (localKey) => {
    const project = get().projects.find((p) => p.localKey === localKey);
    if (project?.id) {
      await canvasAPI.delete(project.id).catch(() => {});
    }
    // Remove localStorage cache
    try { localStorage.removeItem(`canvas_nodes_${localKey}`); } catch {}

    const remaining = get().projects.filter((p) => p.localKey !== localKey);

    // Ensure at least one project
    if (remaining.length === 0) {
      remaining.push({
        id: null,
        localKey: "default",
        name: "默认画布",
        thumbnail: "",
        nodeCount: 0,
        updatedAt: new Date().toISOString(),
        dirty: false,
      });
    }

    const activeKey = get().activeKey;
    const newActive = remaining.some((p) => p.localKey === activeKey)
      ? activeKey
      : remaining[0].localKey;

    set({ projects: remaining, activeKey: newActive });
  },

  switchTo: async (localKey) => {
    // If server canvas has no localStorage cache, pre-fetch from API before switching
    const project = get().projects.find((p) => p.localKey === localKey);
    if (project?.id) {
      try {
        const cached = localStorage.getItem(`canvas_nodes_${localKey}`);
        if (!cached || cached === "[]") {
          const res = await canvasAPI.get(project.id);
          const nodes = res.data?.data?.nodes;
          if (nodes && Array.isArray(nodes) && nodes.length > 0) {
            localStorage.setItem(`canvas_nodes_${localKey}`, JSON.stringify(nodes));
          }
        }
      } catch {}
    }

    set({ activeKey: localKey });
  },

  markDirty: (localKey) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.localKey === localKey ? { ...p, dirty: true } : p
      ),
    }));
  },

  saveToServer: async (localKey, nodes) => {
    const project = get().projects.find((p) => p.localKey === localKey);
    if (!project) return;

    // Get thumbnail from first completed node
    const firstCompleted = nodes.find((n: any) => n.data?.status === "completed" && n.data?.src);
    const thumbnail = firstCompleted?.data?.src || "";

    if (project.id) {
      // Update existing
      await canvasAPI.update(project.id, { name: project.name, nodes, thumbnail });
      set((s) => ({
        projects: s.projects.map((p) =>
          p.localKey === localKey ? { ...p, dirty: false, thumbnail, updatedAt: new Date().toISOString() } : p
        ),
      }));
    } else {
      // Create new
      const res = await canvasAPI.create({ name: project.name, nodes, thumbnail });
      const created = res.data?.data;
      if (created) {
        const newLocalKey = `server-${created.id}`;
        // Migrate localStorage
        try {
          const old = localStorage.getItem(`canvas_nodes_${localKey}`);
          if (old) {
            localStorage.setItem(`canvas_nodes_${newLocalKey}`, old);
            localStorage.removeItem(`canvas_nodes_${localKey}`);
          }
        } catch {}

        set((s) => ({
          projects: s.projects.map((p) =>
            p.localKey === localKey
              ? { ...p, id: created.id, localKey: newLocalKey, dirty: false, thumbnail, updatedAt: created.updated_at }
              : p
          ),
          activeKey: s.activeKey === localKey ? newLocalKey : s.activeKey,
        }));
      }
    }
  },

  updateNodeCount: (localKey, count) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.localKey === localKey ? { ...p, nodeCount: count } : p
      ),
    }));
  },

  updateThumbnail: (localKey, thumbnail) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.localKey === localKey ? { ...p, thumbnail } : p
      ),
    }));
  },
}));
