/**
 * Every look and sound beyond the starter set, and the goal that earns it (season two, Parts C2+C3). Shared by the
 * Worker and the client, so it imports nothing but types. An item's value is the `Look` field value it applies (a
 * sound item gates a radio station instead), so "Try it" sets exactly what the catalogue names.
 */
import type { GoalId } from './goals';

export type Slot = 'scene' | 'path' | 'palette' | 'strand' | 'tree' | 'topper' | 'decor' | 'presents' | 'garland' | 'tag' | 'sound' | 'cursor';

const item = <S extends Slot, V extends string>(slot: S, value: V, label: string, goal: GoalId, prestige: number) =>
  ({ id: `${slot}:${value}` as `${S}:${V}`, slot, value, label, goal, prestige }) as const;

/*
 * Prestige orders the ribbon's "best one": skill (speed, Ao5, precision, feats) 200s, above the calendar (streaks,
 * the board, holidays, Advent, secrets) 100s, above milestones 1–9. Within a band, the harder goal ranks higher.
 */
export const ITEMS = [
  // Milestones
  item('decor', 'tinsel', 'Tinsel', 'm1', 1),
  item('scene', 'midnight', 'Midnight scene', 'm5', 2),
  item('decor', 'canes', 'Candy canes', 'm5', 2),
  item('presents', 'game', 'Festive presents', 'm5', 2),
  item('scene', 'sash', 'Sash scene', 'm10', 3),
  item('path', 'fairy', 'Fairy lights', 'm10', 3),
  item('sound', 'rain', 'Rain station', 'm10', 3),
  item('path', 'neon', 'Neon', 'm25', 4),
  item('decor', 'beads', 'Beads', 'm25', 4),
  item('scene', 'parlour', 'Parlour scene', 'm50', 5),
  item('decor', 'skirt', 'Skirt', 'm50', 5),
  item('strand', 'bubble', 'Bubble lights', 'm100', 6),
  item('presents', 'luxe', 'Luxe wrapping', 'm100', 6),
  item('tree', 'flocked', 'Flocked tree', 'm250', 7),
  item('tree', 'feather', 'Feather tree', 'm500', 8),
  item('tree', 'tinsel', 'Tinsel aluminium tree', 'm1000', 9),
  // Speed and Ao5
  item('garland', 'candlelight', 'Candlelight garland', 's120', 201),
  item('tag', 'silver', 'Silver tag', 's90', 202),
  item('topper', 'star', 'Star topper', 's60', 220),
  item('palette', 'golden', 'Golden bulbs', 's45', 230),
  item('garland', 'gold', 'Gold garland', 's40', 240),
  item('tag', 'goldfoil', 'Gold foil tag', 's35', 250),
  item('strand', 'c9', 'C9 ceramic strand', 'a60', 232),
  item('path', 'neonbright', 'Neon bright', 'a45', 245),
  // Precision
  item('palette', 'candy', 'Candy bulbs', 'clean', 205),
  item('palette', 'gilded', 'Gilded bulbs', 'perfect', 222),
  item('garland', 'mercury', 'Mercury garland', 'clean3', 224),
  // Feats
  item('sound', 'storm', 'Storm station', 'grand', 210),
  item('topper', 'silverstar', 'Silver star topper', 'starLast', 212),
  item('strand', 'candle', 'Candle strand', 'neverDark', 211),
  item('palette', 'emerald', 'Emerald bulbs', 'steady', 213),
  item('tag', 'velvet', 'Velvet tag', 'noPause', 215),
  item('tag', 'tartan', 'Tartan tag', 'comeback', 214),
  // The calendar
  item('topper', 'bow', 'Bow topper', 'streak3', 140),
  item('scene', 'square', 'Town square scene', 'streak7', 141),
  item('presents', 'silver', 'Silver wrapping', 'streak14', 142),
  item('presents', 'tartan', 'Tartan wrapping', 'streak30', 143),
  item('garland', 'champagne', 'Champagne garland', 'top10', 135),
  item('tag', 'holly', 'Holly tag', 'xmasEve', 130),
  item('scene', 'frost', 'Frost scene', 'xmasDay', 131),
  item('topper', 'angel', 'Angel topper', 'xmasDay', 131),
  item('garland', 'silver', 'Silver garland', 'newYear', 132),
  // Secrets
  item('palette', 'disco', 'Disco bulbs', 'eggSecret', 151),
  item('tag', 'plaid', 'Plaid tag', 'eggHomeAlone', 152),
  item('cursor', 'spark', 'Spark cursor', 'threeAm', 150),
  item('tag', 'ember', 'Ember tag', 'fireplace100', 155),
  // Advent
  item('palette', 'classic', 'Classic bulbs', 'door1', 101),
  item('tag', 'frost', 'Frost tag', 'door2', 102),
  item('garland', 'ice', 'Ice garland', 'door3', 103),
  item('presents', 'kraft', 'Kraft wrapping', 'door4', 104),
  item('palette', 'peppermint', 'Peppermint bulbs', 'door5', 105),
  item('tag', 'gingerbread', 'Gingerbread tag', 'door6', 106),
  item('palette', 'ice', 'Ice bulbs', 'door7', 107),
  item('garland', 'pastel', 'Pastel garland', 'door8', 108),
  item('presents', 'starry', 'Starry wrapping', 'door9', 109),
  item('tag', 'snowflake', 'Snowflake tag', 'door10', 110),
  item('palette', 'rosegold', 'Rose gold bulbs', 'door11', 111),
  item('garland', 'classic', 'Classic garland', 'door12', 112),
  item('palette', 'goldsilver', 'Gold & silver bulbs', 'door13', 113),
  item('presents', 'candystripe', 'Candy stripe wrapping', 'door14', 114),
  item('tag', 'kraft', 'Kraft tag', 'door15', 115),
  item('palette', 'snow', 'Snow bulbs', 'door16', 116),
  item('garland', 'peppermint', 'Peppermint garland', 'door17', 117),
  item('tag', 'starry', 'Starry night tag', 'door18', 118),
  item('palette', 'pastel', 'Pastel bulbs', 'door19', 119),
  item('garland', 'rosegold', 'Rose gold garland', 'door20', 120),
  item('palette', 'copper', 'Copper bulbs', 'door21', 121),
  item('tag', 'candystripe', 'Candy stripe tag', 'door22', 122),
  item('palette', 'sapphire', 'Sapphire bulbs', 'door23', 123),
  item('presents', 'goldfoil', 'Gold foil wrapping', 'door24', 124),
  item('topper', 'goldstar', 'Gold star topper', 'advent24', 160),
] as const satisfies readonly { id: `${Slot}:${string}`; slot: Slot; value: string; label: string; goal: GoalId; prestige: number }[];

export type ItemId = (typeof ITEMS)[number]['id'];

export interface ItemDef {
  id: ItemId;
  slot: Slot;
  value: string;
  label: string;
  goal: GoalId;
  /** Orders the ribbon's "best one": higher is better. */
  prestige: number;
}

/** What every player has from the start. Every decoration is off ('none'); the sound starter is the free stations. */
export const STARTER: Readonly<Record<Slot, string>> = {
  scene: 'fireside',
  path: 'filament',
  palette: 'scene',
  strand: 'bulbs',
  tree: 'fir',
  topper: 'snowflake',
  decor: 'none',
  presents: 'none',
  garland: 'game',
  tag: 'plain',
  sound: 'stations',
  cursor: 'plain',
};

const BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));

export const itemOf = (id: string): ItemDef | undefined => BY_ID.get(id);
