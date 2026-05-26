import { openAccelFromCloud } from './repositories/accel-repository.js';
import { openBoardDocumentFromCloud } from './repositories/board-document-repository.js';
import { openReplayFromCloud } from './repositories/replay-repository.js';

export type CloudLibraryOpenResult = string | null;

export async function openCloudReplaySession(name: string): Promise<string> {
  return openReplayFromCloud(name);
}

export async function openCloudAccelRun(name: string): Promise<string> {
  return openAccelFromCloud(name);
}

export async function openCloudBoardDocument(name: string): Promise<CloudLibraryOpenResult> {
  return openBoardDocumentFromCloud(name);
}
