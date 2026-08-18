import { FileStore } from "./persistence/file";
import { getStore, setStore, initStore, closeStore, InitOptions } from "./persistence/db";
import { Project, Task, Agent } from "./types";
import type { Store, ProjectFilters, TaskFilters } from "./persistence/types";

export type { Store, ProjectFilters, TaskFilters };
export { getStore, setStore, initStore, closeStore, InitOptions };

export function setDataDir(dir: string): void {
  setStore(new FileStore(dir));
}

export const getProjects = (filters?: ProjectFilters): Promise<Project[]> => getStore().getProjects(filters);
export const getProject = (id: string): Promise<Project | undefined> => getStore().getProject(id);
export const createProject = (project: Project): Promise<Project> => getStore().createProject(project);
export const updateProject = (id: string, updates: Partial<Project>): Promise<Project | undefined> => getStore().updateProject(id, updates);
export const deleteProject = (id: string): Promise<boolean> => getStore().deleteProject(id);

export const getTasks = (filters?: TaskFilters): Promise<Task[]> => getStore().getTasks(filters);
export const getTask = (id: string): Promise<Task | undefined> => getStore().getTask(id);
export const createTask = (task: Task): Promise<Task> => getStore().createTask(task);
export const updateTask = (id: string, updates: Partial<Task>): Promise<Task | undefined> => getStore().updateTask(id, updates);
export const claimTask = (taskId: string, agentId: string, leaseUntil: string, heartbeatAt: string): Promise<Task | undefined> =>
  getStore().claimTask(taskId, agentId, leaseUntil, heartbeatAt);
export const deleteTask = (id: string): Promise<boolean> => getStore().deleteTask(id);
export const addComment = (taskId: string, comment: { author: string; text: string }): Promise<Task | undefined> => getStore().addComment(taskId, comment);

export const getAgents = (): Promise<Agent[]> => getStore().getAgents();
export const registerAgent = (agent: Agent): Promise<Agent> => getStore().registerAgent(agent);
