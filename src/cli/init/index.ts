// The init wizard and its pure parts (04, chapters 4.10 and 6).
export { detectProject } from './detect.ts';
export type { CiPlatform, PackageManager, ProjectInfo } from './detect.ts';
export { defaultAnswers } from './defaults.ts';
export { unifiedDiff } from './diff.ts';
export { readProjectFiles } from './files.ts';
export type { InitAnswers } from './perf-config.ts';
export { planInitChanges, plannedScripts } from './plan.ts';
export type { FileChange, InitPlan } from './plan.ts';
export { PromptAborted, readlinePrompt } from './prompt.ts';
export { runInit } from './wizard.ts';
