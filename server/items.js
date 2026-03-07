// 10 Grocery items configuration
// Lead time: minutes until procured items arrive in inventory
// Expiry time: minutes until an item expires after arriving in inventory
// Cost: procurement cost per unit
// Price: selling price per unit

const ITEMS = [
  { id: 'eggs',     name: 'Eggs',     emoji: '🥚', leadTime: 0.3, expiryTime: 3,   cost: 3.50,  price: 5.00,  initialStock: 10 },
  { id: 'milk',     name: 'Milk',     emoji: '🥛', leadTime: 0.3, expiryTime: 2.5, cost: 2.00,  price: 3.50,  initialStock: 10 },
  { id: 'bread',    name: 'Bread',    emoji: '🍞', leadTime: 0.3, expiryTime: 2,   cost: 1.50,  price: 2.80,  initialStock: 10 },
  { id: 'tomatoes', name: 'Tomatoes', emoji: '🍅', leadTime: 0.4, expiryTime: 3,   cost: 2.50,  price: 4.00,  initialStock: 10 },
  { id: 'chicken',  name: 'Chicken',  emoji: '🍗', leadTime: 0.5, expiryTime: 2,   cost: 5.00,  price: 8.00,  initialStock: 10 },
  { id: 'rice',     name: 'Rice',     emoji: '🍚', leadTime: 0.5, expiryTime: 4,   cost: 1.80,  price: 3.00,  initialStock: 10 },
  { id: 'bananas',  name: 'Bananas',  emoji: '🍌', leadTime: 0.3, expiryTime: 1.5, cost: 1.20,  price: 2.00,  initialStock: 10 },
  { id: 'yogurt',   name: 'Yogurt',   emoji: '🥄', leadTime: 0.3, expiryTime: 0.5, cost: 1.80,  price: 3.00,  initialStock: 10 },
  { id: 'lettuce',  name: 'Lettuce',  emoji: '🥬', leadTime: 0.3, expiryTime: 1,   cost: 1.50,  price: 2.50,  initialStock: 10 },
  { id: 'cheese',   name: 'Cheese',   emoji: '🧀', leadTime: 0.4, expiryTime: 2,   cost: 4.00,  price: 6.50,  initialStock: 10 },
];

export const ITEMS_MAP = Object.fromEntries(ITEMS.map(item => [item.id, item]));
export default ITEMS;
