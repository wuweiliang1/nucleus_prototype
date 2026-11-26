import type { AgentId } from './types.js';

export function getMentionedAgent(prompt: string): AgentId | undefined {
  const name = /(?<![a-z0-9._%+@-])@(mike|emma|bob|alex)(?![a-z0-9_@-]|\.[a-z0-9])/iu
    .exec(prompt)?.[1]?.toLowerCase();
  switch (name) {
    case 'mike':
    case 'emma':
    case 'bob':
    case 'alex':
      return name;
    default:
      return undefined;
  }
}
