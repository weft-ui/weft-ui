// IDs are stable across pagination and deep links. New refreshes use negative IDs.
export interface FeedNote {
  id: number;
  cover: string;
  title: string;
  category: string;
  author: string;
  avatar: string;
  likes: number;
}

export interface NoteComment {
  id: number;
  name: string;
  date: string;
  message: string;
  avatar: string;
}

const stories = [
  { cover: "asset:field_ridge", title: "The long way up Juniper Ridge", category: "MOUNTAINS  /  6 MIN READ", author: "Mara Chen", avatar: "asset:field_mara" },
  { cover: "asset:field_coast", title: "A tidepool walk at Salt Point", category: "COAST  /  4 MIN READ", author: "Ivo Reyes", avatar: "asset:avatar" },
  { cover: "asset:hero", title: "A clear night above the tree line", category: "AFTER DARK  /  5 MIN READ", author: "Mara Chen", avatar: "asset:field_mara" },
] as const;

const MAX_NOTES = 10_000;

export function noteForId(id: number): FeedNote {
  const index = ((id % stories.length) + stories.length) % stories.length;
  return { id, ...stories[index]!, likes: 40 + ((Math.abs(id) * 17) % 160) };
}

function notesFrom(start: number, count: number): FeedNote[] {
  return Array.from({ length: count }, (_, index) => noteForId(start + index));
}

export function createFeed(): FeedNote[] {
  return notesFrom(0, 200);
}

export function appendFeed(notes: readonly FeedNote[]): readonly FeedNote[] {
  const count = Math.min(50, MAX_NOTES - notes.length);
  if (count <= 0) return notes;
  // Refresh notes are negative; positive IDs continue from the last loaded note.
  const start = notes.reduce((next, note) => Math.max(next, note.id + 1), 0);
  return [...notes, ...notesFrom(start, count)];
}

export function refreshFeed(notes: readonly FeedNote[]): FeedNote[] {
  const first = notes.reduce((min, note) => Math.min(min, note.id), 0);
  return [...notesFrom(first - 5, 5), ...notes].slice(0, MAX_NOTES);
}

export function createBench(count: number): FeedNote[] {
  return notesFrom(0, Math.max(0, Math.min(MAX_NOTES, Math.floor(count))));
}

export function createComments(): NoteComment[] {
  return [
    { id: 0, name: "Ivo Reyes", date: "Oct 13", message: "The fire road is still firm after the rain.", avatar: "asset:avatar" },
    { id: 1, name: "Mara Chen", date: "Oct 14", message: "Good to know. The creek bed was dry on Saturday.", avatar: "asset:field_mara" },
  ];
}
