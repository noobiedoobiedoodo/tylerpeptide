export interface SessionContext {
  sessionId: string;
  sessionGeneration: number;
}

export interface TurnContext extends SessionContext {
  turnId: string;
  turnGeneration: number;
}

export interface RequestContext extends TurnContext {
  requestId: string;
}

export function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export class SessionContextManager {
  private sessionId: string;
  private sessionGeneration: number = 0;
  private currentTurnId: string | null = null;
  private turnGeneration: number = 0;
  private recognitionGeneration: number = 0;
  private ttsGeneration: number = 0;

  constructor() {
    this.sessionId = generateId('S');
    this.sessionGeneration = 1;
  }

  public getSessionId() { return this.sessionId; }
  public getSessionGeneration() { return this.sessionGeneration; }

  public incrementSessionGeneration() {
    this.sessionGeneration++;
  }

  public startNewTurn(): TurnContext {
    this.currentTurnId = generateId('T');
    this.turnGeneration++;
    return this.getCurrentTurnContext();
  }

  public getCurrentTurnContext(): TurnContext {
    if (!this.currentTurnId) {
      this.startNewTurn();
    }
    return {
      sessionId: this.sessionId,
      sessionGeneration: this.sessionGeneration,
      turnId: this.currentTurnId!,
      turnGeneration: this.turnGeneration
    };
  }

  public assertActiveContext(event: Partial<TurnContext> & { sessionId: string; sessionGeneration: number }): boolean {
    if (event.sessionId !== this.sessionId || event.sessionGeneration !== this.sessionGeneration) {
      console.warn(`[Stale Event Dropped] Session/Generation mismatch. Expected S:${this.sessionId} G:${this.sessionGeneration}, got S:${event.sessionId} G:${event.sessionGeneration}`);
      return false;
    }
    if (event.turnId && event.turnId !== this.currentTurnId) {
      console.warn(`[Stale Event Dropped] Turn mismatch. Expected T:${this.currentTurnId}, got T:${event.turnId}`);
      return false;
    }
    if (event.turnGeneration && event.turnGeneration !== this.turnGeneration) {
      console.warn(`[Stale Event Dropped] Turn Generation mismatch.`);
      return false;
    }
    return true;
  }

  public nextRecognitionGeneration(): number {
    return ++this.recognitionGeneration;
  }

  public getRecognitionGeneration(): number {
    return this.recognitionGeneration;
  }

  public nextTTSGeneration(): number {
    return ++this.ttsGeneration;
  }

  public getTTSGeneration(): number {
    return this.ttsGeneration;
  }
}
