/**
 * Type definitions for ActivityJournal snapshots persisted on the plugin side.
 * Mirrors the frontend ActivityJournal.toJSON() / restore() shape.
 */

export interface ActivityEntry {
  action: string;
  location?: string;
  detail?: string;
  timestamp: number;
}

export interface DialogueRecord {
  partner: { npcId: string; name: string };
  topic?: string;
  summary: string;
  timestamp: number;
}

export interface Relationship {
  npcId: string;
  name: string;
  label: string;
  sentiment: number; // -1..1
  lastInteraction: number;
  interactionCount: number;
  recentTopics: string[];
}

export interface DailyReflection {
  day: number;
  summary: string;
  timestamp: number;
}

export interface DailyPlanItem {
  time: string;
  action: string;
  location?: string;
  done?: boolean;
}

export interface DailyPlan {
  day: number;
  items: DailyPlanItem[];
  suspended?: boolean;
}

export interface ActivityJournalSnapshot {
  npcId: string;
  npcName: string;
  entries: ActivityEntry[];
  dialogues: DialogueRecord[];
  relationships: Array<[string, Relationship]>;
  reflections: DailyReflection[];
  currentPlan: DailyPlan | null;
}
