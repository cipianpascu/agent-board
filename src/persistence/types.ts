import { Project, Task, Agent } from "../types";

export interface ProjectFilters {
  status?: string;
  owner?: string;
}

export interface TaskFilters {
  projectId?: string;
  assignee?: string;
  status?: string;
  tag?: string;
}

export interface Store {
  ready?(): Promise<void>;

  // Projects
  getProjects(filters?: ProjectFilters): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  createProject(project: Project): Promise<Project>;
  updateProject(id: string, updates: Partial<Project>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<boolean>;

  // Tasks
  getTasks(filters?: TaskFilters): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  createTask(task: Task): Promise<Task>;
  updateTask(id: string, updates: Partial<Task>): Promise<Task | undefined>;
  deleteTask(id: string): Promise<boolean>;
  addComment(taskId: string, comment: { author: string; text: string }): Promise<Task | undefined>;

  // Agents
  getAgents(): Promise<Agent[]>;
  registerAgent(agent: Agent): Promise<Agent>;

  // Lifecycle
  close?(): void | Promise<void>;
}
