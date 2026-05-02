import { describe, expect, it } from "vitest";
import {
  createBlankSession,
  createOpenedDocumentSession,
  createRestoredSession,
  isCloudEligible,
  isNamedDocument,
  hasUnsavedWork,
  needsTitleForSave,
  markContentModified,
  markSaved,
  markDeleted,
} from "../../src/board/document-session.js";

describe("document-session", () => {
  it("creates a blank session with no remote document", () => {
    const session = createBlankSession();
    expect(session.remoteDocumentName).toBeNull();
    expect(session.documentTitle).toBe("");
    expect(session.hasUserContent).toBe(false);
    expect(session.isDirty).toBe(false);
    expect(session.openedFromCloud).toBe(false);
    expect(session.materializedRemotely).toBe(false);
  });

  it("creates an opened document session from cloud", () => {
    const session = createOpenedDocumentSession({
      name: "DOC-001",
      title: "My Board",
      hasContent: true,
      linkedPngName: "PNG-001",
    });
    expect(session.remoteDocumentName).toBe("DOC-001");
    expect(session.documentTitle).toBe("My Board");
    expect(session.hasUserContent).toBe(true);
    expect(session.openedFromCloud).toBe(true);
    expect(session.materializedRemotely).toBe(true);
    expect(session.linkedPngDrawingName).toBe("PNG-001");
  });

  it("creates a restored session from local metadata", () => {
    const session = createRestoredSession({
      name: "DOC-002",
      title: "Restored",
      hasContent: false,
    });
    expect(session.remoteDocumentName).toBe("DOC-002");
    expect(session.documentTitle).toBe("Restored");
    expect(session.openedFromCloud).toBe(false);
    expect(session.materializedRemotely).toBe(true);
  });

  it("isCloudEligible returns true for named documents", () => {
    const session = createOpenedDocumentSession({ name: "DOC-003", title: "T", hasContent: true });
    expect(isCloudEligible(session)).toBe(true);
  });

  it("isCloudEligible returns false for blank sessions", () => {
    expect(isCloudEligible(createBlankSession())).toBe(false);
  });

  it("isNamedDocument checks remote document name", () => {
    expect(isNamedDocument(createBlankSession())).toBe(false);
    expect(isNamedDocument(createOpenedDocumentSession({ name: "DOC-004", title: "T", hasContent: false }))).toBe(true);
  });

  it("hasUnsavedWork returns true for dirty sessions with content", () => {
    const session = createBlankSession();
    expect(hasUnsavedWork(session)).toBe(false);

    markContentModified(session);
    expect(hasUnsavedWork(session)).toBe(true);
  });

  it("needsTitleForSave returns true for unnamed sessions", () => {
    const blank = createBlankSession();
    expect(needsTitleForSave(blank)).toBe(true);

    const named = createOpenedDocumentSession({ name: "DOC-005", title: "T", hasContent: true });
    expect(needsTitleForSave(named)).toBe(false);
  });

  it("markContentModified sets isDirty and hasUserContent", () => {
    const session = createBlankSession();
    markContentModified(session);
    expect(session.isDirty).toBe(true);
    expect(session.hasUserContent).toBe(true);
    expect(session.lastModifiedAtMs).toBeGreaterThan(0);
  });

  it("markSaved updates session state", () => {
    const session = createBlankSession();
    markContentModified(session);
    markSaved(session, { name: "DOC-006", title: "Saved Board" });
    expect(session.remoteDocumentName).toBe("DOC-006");
    expect(session.documentTitle).toBe("Saved Board");
    expect(session.isDirty).toBe(false);
    expect(session.materializedRemotely).toBe(true);
    expect(session.lastSavedAtMs).toBeGreaterThan(0);
  });

  it("markDeleted resets document reference", () => {
    const session = createOpenedDocumentSession({ name: "DOC-007", title: "T", hasContent: true });
    markDeleted(session);
    expect(session.remoteDocumentName).toBeNull();
    expect(session.documentTitle).toBe("");
    expect(session.hasUserContent).toBe(false);
    expect(session.isDirty).toBe(false);
    expect(session.deleteState).toBe("idle");
  });
});
