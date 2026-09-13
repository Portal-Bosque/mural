// Port of Core/Themes.swift and Core/Languages/*.swift. IDs are stable storage keys.

export interface ConversationTheme {
  id: string; title: string; subtitle: string; symbol: string; category: string; situation: string; colorIndex: number;
}
const t = (id: string, title: string, subtitle: string, symbol: string, category: string, situation: string, colorIndex: number): ConversationTheme =>
  ({ id, title, subtitle, symbol, category, situation, colorIndex });

export const sharedThemes: ConversationTheme[] = [
  t('coffee', 'A coffee?', 'Something warm, please', 'cup.and.saucer', 'Everyday', 'You work in a cosy café. Help the learner order, then chat naturally.', 0),
  t('weekend', 'The weekend', 'Tell me about yours', 'sun.horizon', 'Connection', 'Ask about the learner’s weekend. Practise past events and follow their interests.', 1),
  t('walk', 'A little walk', 'Out into the fresh air', 'tree', 'Local life', 'Take an imagined forest walk together. Talk about nature, weather and daily life.', 2),
  t('dinner', 'Dinner plans', 'Let’s make something', 'fork.knife', 'Everyday', 'Plan dinner together. Ask about ingredients, preferences and the steps of cooking.', 3),
  t('introductions', 'Nice to meet you', 'Start somewhere small', 'hand.wave', 'Connection', 'Meet the learner for the first time. Learn their interests through natural introductions.', 0),
  t('groceries', 'At the market', 'Find the good tomatoes', 'basket', 'Everyday', 'Help the learner shop at a local food market. Practise quantities and questions.', 2),
  t('travel', 'Next stop', 'A ticket to somewhere', 'tram', 'Everyday', 'Plan a train trip. Discuss routes and tickets without inventing real current schedules.', 1),
  t('home', 'A place of your own', 'Make yourself at home', 'house', 'Everyday', 'Discuss a home, rooms, moving and what makes a place comfortable.', 3),
  t('friends', 'New friends', 'An invitation, maybe', 'person.2', 'Connection', 'You are a friendly new acquaintance. Arrange something to do together.', 0),
  t('work', 'Monday morning', 'Around the office', 'briefcase', 'Everyday', 'Chat as colleagues. Discuss work, meetings and a small problem to solve.', 1),
  t('weather', 'Rain again?', 'Whatever the weather', 'cloud.rain', 'Local life', 'Talk about weather, clothing and outdoor plans. Do not claim today’s forecast without sources.', 1),
  t('cabin', 'A weekend away', 'A quieter kind of day', 'mountain.2', 'Local life', 'Plan a weekend away: travel, food, walks and relaxing together.', 2),
  t('music', 'On repeat', 'What are you listening to?', 'music.note', 'Interests', 'Ask about music the learner enjoys. Explore feelings, favourites and concerts.', 0),
  t('film', 'One more episode', 'Something worth watching', 'film', 'Interests', 'Discuss films and series. Ask for opinions and avoid unwanted spoilers.', 1),
  t('books', 'Between the pages', 'A story that stayed', 'book', 'Interests', 'Chat about books, characters, stories and why they matter to the learner.', 3),
  t('design', 'Good things', 'Made with a little care', 'pencil.and.outline', 'Interests', 'Explore design, architecture and objects the learner loves. Ask for concrete opinions.', 0),
  t('technology', 'What comes next', 'Ideas, tools and tomorrow', 'sparkles', 'Interests', 'Discuss technology and how it changes daily life. Delegate claims needing current facts.', 1),
  t('travelstories', 'Somewhere else', 'A place you remember', 'globe.europe.africa', 'Interests', 'Exchange travel stories and dream destinations. Invite descriptions and comparisons.', 2),
  t('restaurant', 'A table for two', 'Stay for dessert', 'wineglass', 'Everyday', 'Role-play a restaurant meal. Practise requests, preferences and polite problem-solving.', 0),
  t('neighbours', 'Next door', 'A familiar face', 'building.2', 'Connection', 'Chat as neighbours. Discuss the neighbourhood and small requests for help.', 3),
  t('traditions', 'Everyday customs', 'Small customs, big stories', 'flag', 'Local life', 'Explore everyday customs with nuance. Avoid treating a whole culture as alike.', 2),
  t('opinions', 'What do you think?', 'Room for another view', 'quote.bubble', 'Connection', 'Choose an everyday dilemma. Invite reasons and gently explore another perspective.', 1),
  t('future', 'A year from now', 'Plans worth talking about', 'paperplane', 'Connection', 'Talk about hopes and future plans. Explore possibilities and practical next steps.', 3),
  t('today', 'The world today', 'Something to talk about', 'newspaper', 'Interests', 'Ask what current topic interests the learner, then delegate a source-backed lookup before discussing facts.', 0),
];

export interface LanguageModule {
  id: string; name: string; nativeName: string; variety: string; locale: string;
  greeting: string; greetingWord: string;
  speechGuidance: string; writingGuidance: string; lemmaGuidance: string;
  teachingFocus: string[]; topicPlaceholder: string; lookupUnavailableReply: string;
  themeOverrides: Record<string, ConversationTheme>;
}
export const themesFor = (language: LanguageModule): ConversationTheme[] => sharedThemes.map(s => language.themeOverrides[s.id] ?? s);
export const defaultTitle = (language: LanguageModule) => `A little ${language.name}`;

export const norwegian: LanguageModule = {
  id: 'nb', name: 'Norwegian', nativeName: 'Norsk', variety: 'Bokmål', locale: 'nb-NO', greeting: 'Hei!', greetingWord: 'hei',
  speechGuidance: 'Use natural Eastern Norwegian pronunciation. Accept other Norwegian dialects without treating dialect differences as errors.',
  writingGuidance: 'Use Norwegian Bokmål spelling and wording.',
  lemmaGuidance: 'Give nouns with their singular grammatical article and verbs in the infinitive, for example en tur and å gå. Accept valid gender variants.',
  teachingFocus: [
    'Greetings, introductions and short everyday chunks.',
    'Simple questions, noun gender and present-tense everyday exchanges.',
    'Connected stories, past tense, word order and familiar situations.',
    'Reasons and opinions, subordinate clauses and natural connectors.',
    'Nuanced discussion, idiomatic phrasing and register.',
    'Flexible advanced conversation with precise, natural Norwegian.',
  ],
  topicPlaceholder: 'Design, space, life in Norway…',
  lookupUnavailableReply: 'Jeg klarte ikke å sjekke det akkurat nå. Vi kan snakke om temaet generelt, hvis du vil.',
  themeOverrides: {
    groceries: t('groceries', 'At the market', 'Find the good tomatoes', 'basket', 'Everyday', 'Help the learner shop at a Norwegian food market. Practise quantities and questions.', 2),
    travel: t('travel', 'Next stop', 'A ticket to somewhere', 'tram', 'Everyday', 'Plan a train trip in Norway. Discuss routes and tickets without inventing current schedules.', 1),
    weather: t('weather', 'Rain again?', 'A very Norwegian chat', 'cloud.rain', 'Local life', 'Talk about weather, clothing and outdoor plans in Norway. Verify current forecasts before claiming them.', 1),
    cabin: t('cabin', 'Cabin weekend', 'A quieter kind of day', 'mountain.2', 'Local life', 'Plan a hytte weekend: travel, food, walks and relaxing together.', 2),
    traditions: t('traditions', 'Life in Norway', 'Small customs, big stories', 'flag', 'Local life', 'Explore Norwegian everyday customs with nuance. Avoid treating all Norwegians as alike.', 2),
  },
};

export const spanish: LanguageModule = {
  id: 'es', name: 'Spanish', nativeName: 'Español', variety: 'Spain', locale: 'es-ES', greeting: '¡Hola!', greetingWord: 'hola',
  speechGuidance: 'Use clear Spanish from Spain, with a natural distinction between s and z/soft c, tú for friendly singular address and vosotros for informal plural address. Accept seseo, ustedes, voseo and other valid regional forms without marking them wrong. Do not imitate a regional caricature.',
  writingGuidance: 'Use standard Spanish spelling, accents and opening question and exclamation marks.',
  lemmaGuidance: 'Give nouns with their singular grammatical article and verbs in the infinitive, for example la casa and hablar. Keep reflexive verbs such as llamarse distinct. Preserve accents and ñ.',
  teachingFocus: [
    'Greetings, introductions and short useful chunks such as me llamo and quiero.',
    'Everyday questions, gender and number agreement, present tense and useful ser/estar contrasts.',
    'Connected stories, past events, object pronouns and familiar situations.',
    'Reasons and opinions, contrasts between past tenses and common subjunctive contexts.',
    'Nuance, hypothetical situations, register and regional variation.',
    'Flexible advanced discussion with precise, idiomatic Spanish.',
  ],
  topicPlaceholder: 'Food, travel, music, life in Spain…',
  lookupUnavailableReply: 'No he podido comprobarlo ahora mismo. Si quieres, podemos hablar del tema en general.',
  themeOverrides: {
    coffee: t('coffee', 'Un café', 'Something warm, please', 'cup.and.saucer', 'Everyday', "Meet in a neighbourhood café in Spain. Order a drink and chat. Ask about the learner's interests.", 0),
    groceries: t('groceries', 'En el mercado', 'A little of everything', 'basket', 'Everyday', 'Visit a local market in a Spanish-speaking community. Practise quantities, prices and polite questions. Respect regional food vocabulary.', 2),
    travel: t('travel', 'Next stop', 'A ticket to somewhere', 'tram', 'Everyday', 'Plan a trip in Spain. Discuss transport and tickets without inventing current schedules.', 1),
    cabin: t('cabin', 'A weekend away', 'Somewhere in the sunshine', 'mountain.2', 'Local life', 'Plan an imagined weekend in a Spanish-speaking place. Choose a city, coast or countryside together and discuss practical plans.', 2),
    traditions: t('traditions', 'La sobremesa', 'Let the conversation linger', 'fork.knife', 'Local life', 'Talk after a shared meal about daily routines, family and local customs. Compare experiences without treating Spanish-speaking cultures as uniform.', 2),
  },
};

export const english: LanguageModule = {
  id: 'en', name: 'English', nativeName: 'English', variety: 'International', locale: 'en', greeting: 'Hi!', greetingWord: 'hi',
  speechGuidance: 'Use clear, broadly intelligible English with a consistent, natural pronunciation. Accept valid regional accents, vocabulary and grammar, including British and American forms. Do not treat an accent difference as an error or require imitation of a native accent. Correct pronunciation only when meaning is unclear and the audio supports the correction.',
  writingGuidance: 'Use standard English spelling and punctuation. Keep one spelling convention within your own reply, but accept valid regional spelling and usage from the learner.',
  lemmaGuidance: 'Give countable nouns in the singular and verbs in the base form, for example a journey and go. Keep meaningful phrasal verbs such as look after together. Use a short, plain English definition as the stable sense rather than repeating the word itself.',
  teachingFocus: [
    "Greetings, introductions and useful everyday chunks such as I'd like and my name is.",
    'Everyday questions, present forms, articles and common countable and uncountable nouns.',
    'Connected stories, past events, future plans and familiar situations.',
    'Reasons and opinions, present perfect in context, conditionals and natural linking phrases.',
    'Nuance, idiomatic expressions, reported speech and appropriate register.',
    'Flexible advanced discussion with precise language, implication and tact.',
  ],
  topicPlaceholder: 'Travel, films, work, everyday life…',
  lookupUnavailableReply: "I couldn't check that just now. We can talk about the topic more generally, if you like.",
  themeOverrides: {
    coffee: t('coffee', 'A coffee?', 'Something warm, please', 'cup.and.saucer', 'Everyday', "Meet in a neighbourhood café. Order a drink and chat in English. Follow the learner's interests and accept regional vocabulary.", 0),
    travel: t('travel', 'Next stop', 'A ticket to somewhere', 'tram', 'Everyday', 'Plan a trip using English. Let the learner choose the destination. Discuss transport and tickets without inventing current schedules.', 1),
    traditions: t('traditions', 'Everyday customs', 'Small customs, big stories', 'flag', 'Local life', "Compare everyday customs from places the learner knows. English is used across many cultures; avoid presenting one country's habits as universal.", 2),
  },
};

export const french: LanguageModule = {
  id: 'fr', name: 'French', nativeName: 'Français', variety: 'France', locale: 'fr-FR', greeting: 'Salut !', greetingWord: 'salut',
  speechGuidance: 'Use clear, natural metropolitan French pronunciation. Use tu in a friendly conversation and vous when the situation calls for formality or plural address. Accept valid regional accents, vocabulary and grammar from across the French-speaking world. Do not treat regional variation, informal omission of ne or a non-native accent alone as an error. Do not imitate a regional caricature.',
  writingGuidance: 'Use standard French spelling, accents, apostrophes and punctuation. Preserve accents on capital letters. Match the register to the situation and accept valid regional usage from the learner.',
  lemmaGuidance: 'Give nouns with a singular article that makes gender clear where possible and verbs in the infinitive, for example une maison, un ami and parler. Keep pronominal verbs such as se souvenir distinct. Preserve accents and meaningful elisions.',
  teachingFocus: [
    "Greetings, introductions and useful everyday chunks such as je m'appelle and je voudrais.",
    'Everyday questions, grammatical gender, present tense and common negation in conversation.',
    'Connected stories, passé composé and imparfait in context, future plans and familiar situations.',
    'Reasons and opinions, object pronouns, conditional requests and common subjunctive contexts.',
    'Nuance, hypothetical situations, register, idiomatic phrasing and regional variation.',
    'Flexible advanced discussion with precise, natural French and appropriate tone.',
  ],
  topicPlaceholder: 'Food, cinema, travel, life in France…',
  lookupUnavailableReply: "Je n'ai pas pu vérifier ça pour le moment. On peut parler du sujet en général, si tu veux.",
  themeOverrides: {
    coffee: t('coffee', 'Un café ?', 'Something warm, please', 'cup.and.saucer', 'Everyday', 'Meet in a neighbourhood café in France. Order a drink and chat. Use polite greetings with staff and a friendly register with the learner.', 0),
    groceries: t('groceries', 'Au marché', 'A little of everything', 'basket', 'Everyday', 'Visit a local market in France. Practise quantities, prices and polite requests, then ask what the learner likes to cook.', 2),
    travel: t('travel', 'En route', 'A ticket to somewhere', 'tram', 'Everyday', 'Plan a trip in France. Discuss transport, directions and tickets without inventing current schedules.', 1),
    cabin: t('cabin', 'A weekend away', 'A change of scene', 'mountain.2', 'Local life', 'Plan an imagined weekend in a French-speaking place. Choose a city, coast or countryside together and discuss practical plans.', 2),
    traditions: t('traditions', 'À table', 'Stay a little longer', 'fork.knife', 'Local life', "Talk over an imagined meal about daily routines and local customs. Compare the learner's experiences with life in France without treating French-speaking cultures as uniform.", 2),
  },
};

export const LanguageRegistry = {
  defaultID: 'nb',
  all: [norwegian, spanish, english, french] as LanguageModule[],
  module(id: string): LanguageModule | undefined { return this.all.find(l => l.id === id); },
};

export const MeaningLanguages = {
  all: ['English', 'French', 'German', 'Spanish', 'Norwegian', 'Portuguese', 'Italian', 'Polish', 'Arabic', 'Ukrainian'],
  greeting(language: string): string {
    return ({ English: 'Hi!', French: 'Salut !', German: 'Hallo!', Spanish: '¡Hola!', Norwegian: 'Hei!', Portuguese: 'Olá!', Italian: 'Ciao!', Polish: 'Cześć!', Arabic: 'مرحبًا!', Ukrainian: 'Привіт!' } as Record<string, string>)[language] ?? 'Hi!';
  },
};
