// Conversation topics for the kids profile (ages 6–10). English is the kids' learning language.
import type { ConversationTheme } from './languages';

export interface KidsTheme extends ConversationTheme { emoji: string }
const k = (id: string, emoji: string, title: string, subtitle: string, situation: string, colorIndex: number): KidsTheme =>
  ({ id: `kids-${id}`, emoji, title, subtitle, symbol: '', category: 'Kids', situation, colorIndex });

export const kidsThemes: KidsTheme[] = [
  k('animal', '🦁', 'My favorite animal', 'Roar, squeak or moo!', 'Talk about the child’s favorite animal: what it eats, where it lives, what sound it makes. Make animal sounds together and compare two animals.', 0),
  k('dinos', '🦖', 'Dinosaurs!', 'Big, small and very loud', 'Play with dinosaurs: which one is biggest, which one would the child be, what a dinosaur eats for breakfast. Practise big/small, fast/slow, and colors.', 2),
  k('space', '🚀', 'Space adventure', 'Rockets and planets', 'Pretend to fly a rocket together: count down from 5, visit a planet, meet a friendly alien, float in zero gravity. Practise numbers and “I can see…”.', 1),
  k('sea', '🐙', 'Under the sea', 'Fish, sharks and treasure', 'Dive under the sea: name sea animals, find a treasure chest, describe colors and how many fish. Practise counting and colors.', 1),
  k('hero', '🦸', 'Superpowers', 'Pick your power', 'Invent a superhero: choose a power, a name and a costume color, then save a cat from a tree. Practise “I can…” and “I want…”.', 3),
  k('pet', '🐶', 'My pet', 'Or the pet of your dreams', 'Talk about the child’s pet or the pet they wish they had: its name, what it likes, a trick it can do. Practise “has”, “likes” and daily routine words.', 0),
  k('party', '🎂', 'Birthday party', 'Cake, games and friends', 'Plan a birthday party: who comes, what cake, which games, what present. Practise food words, numbers and “Would you like…?”.', 3),
  k('food', '🍕', 'Yummy food', 'And yucky food too', 'Talk about favorite foods and foods the child hates. Pretend to cook a silly pizza with strange toppings. Practise “I like / I don’t like”.', 3),
  k('zoo', '🐘', 'At the zoo', 'Which animal first?', 'Pretend to visit a zoo: choose the path, see animals, feed the giraffe, decide which animal is funniest. Practise “Let’s go…” and adjectives.', 2),
  k('dragon', '🐉', 'Dragons and magic', 'A friendly dragon', 'A friendly dragon needs help: choose a magic word, fly over a castle, find the lost crown. Practise action verbs and colors.', 1),
  k('day', '🎒', 'My day', 'School, friends and play', 'Ask about the child’s day: school, best friend, favorite game at recess, what they ate. Practise past tense gently: “I played…”.', 0),
  k('monster', '👾', 'Silly monsters', 'Invent a monster', 'Invent a monster together: how many eyes and legs, what color, what it eats, its funny name. Practise body parts and numbers.', 2),
  k('robot', '🤖', 'Robots', 'Beep boop!', 'Build a robot: what it can do, what buttons it has, talk in a robot voice for a moment. Practise “It can…” and parts of the body.', 1),
  k('sports', '⚽', 'Sports and games', 'Goal!', 'Talk about sports and games: soccer, tag, video games, a favorite team or character. Practise “I play…” and “my favorite…”.', 2),
];
export const randomKidsTheme = () => kidsThemes[Math.floor(Math.random() * kidsThemes.length)];
