import { openAccelFromCloud } from './repositories/accel-repository.js';
import { openBoardDocumentFromCloud } from './repositories/board-document-repository.js';
import { openReplayFromCloud } from './repositories/replay-repository.js';

export async function openCloudReplaySession(name) {
  return openReplayFromCloud(name);
}

export async function openCloudAccelRun(name) {
  return openAccelFromCloud(name);
}

export async function openCloudBoardDocument(name) {
  return openBoardDocumentFromCloud(name);
}
