import type { ColorFamily, Paint } from '../types'

const raw: [string, string, ColorFamily][] = [
  ['Chalk White', '#f3f1ea', 'White'],
  ['Swiss Coffee', '#ece4d4', 'White'],
  ['Linen', '#e8dcc6', 'Beige'],
  ['Oat Milk', '#dccdb2', 'Beige'],
  ['Sandstone', '#c9b08c', 'Beige'],
  ['Greige', '#b9b1a5', 'Grey'],
  ['Pebble', '#a5a7a4', 'Grey'],
  ['Slate', '#6d747a', 'Grey'],
  ['Charcoal', '#3b3e42', 'Black'],
  ['Jet', '#1e1f21', 'Black'],
  ['Mocha', '#7b5d48', 'Brown'],
  ['Terracotta', '#b5643f', 'Brown'],
  ['Cinnamon', '#995436', 'Brown'],
  ['Powder Blue', '#b9cfe0', 'Blue'],
  ['Denim', '#4f6f93', 'Blue'],
  ['Navy', '#22324a', 'Blue'],
  ['Teal', '#2f6b6b', 'Blue'],
  ['Sage', '#a9b79d', 'Green'],
  ['Olive', '#6f7348', 'Green'],
  ['Forest', '#2f4a3b', 'Green'],
  ['Mint', '#c7e0d1', 'Green'],
  ['Blush', '#e8c4bb', 'Pink'],
  ['Dusty Rose', '#c99590', 'Pink'],
  ['Mauve', '#9b7b8a', 'Pink'],
  ['Mustard', '#d2a03b', 'Multi'],
  ['Saffron', '#e5b04a', 'Multi'],
  ['Lavender', '#b8aed0', 'Multi'],
  ['Coral', '#e5836b', 'Multi'],
]

export const PAINTS: Paint[] = raw.map(([name, hex, family], i) => ({ id: `c${i + 1}`, name, hex, family }))
