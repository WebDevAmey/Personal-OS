export interface EmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: Date;
}

export interface EmailCapability {
  search(query: string): Promise<EmailMessage[]>;
  read(id: string): Promise<EmailMessage & { body: string }>;
  draft(input: { to: string; subject: string; body: string }): Promise<{ draftId: string }>;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location?: string;
}

export interface CalendarCapability {
  search(range: { from: Date; to: Date }): Promise<CalendarEvent[]>;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebCapability {
  search(query: string): Promise<WebResult[]>;
  read(url: string): Promise<string>;
}
