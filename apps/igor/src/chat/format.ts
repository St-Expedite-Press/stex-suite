// Date and label formatting for the Igor interface (English).

import type { Health, Message } from './types';

const timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const shortDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Sidebar date: "Just now", "N min ago", "Today", "Yesterday", else "Nov 3". */
export function formatRelative(iso: string, now: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor((now - date.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const today = new Date(now);
  if (sameDay(date, today)) return 'Today';
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return 'Yesterday';
  return shortDateFormat.format(date);
}

/** Message time, e.g. "10:24 AM". */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date);
}

export function formatFullDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : fullDateFormat.format(date);
}

export function transportLabel(transport: Health['transport']): string {
  if (transport === 'fake') return 'Simulated replies (fake transport)';
  if (transport === 'remote') return 'Live · Hermes';
  return 'Igor unavailable';
}

/** Transport of the most recent assistant reply that reports one. */
export function lastReplyTransport(messages: readonly Message[]): Message['transport'] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant' && message.transport) return message.transport;
  }
  return undefined;
}
