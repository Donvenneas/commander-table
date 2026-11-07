// Four cEDH-style decks for a high-powered table: fast mana, tutors, free interaction and compact
// combos. They're built from the archetypes the competitive format is known for, trimmed to the cards
// the simulator understands best, and filled out with basic lands.

const deck = (commanders, cards, basics) => ['Commander', ...commanders.map(c => `1 ${c}`), '', 'Deck', ...cards.map(c => `1 ${c}`), ...basics].join('\n');

export const CEDH_PRESETS = [
  {
    name: 'Kinnan, Bonder Prodigy',
    list: deck(['Kinnan, Bonder Prodigy'], [
      'Basalt Monolith', 'Grim Monolith', 'Rings of Brighthearth', 'Power Artifact', 'Isochron Scepter', 'Dramatic Reversal',
      "Thassa's Oracle", 'Walking Ballista', 'Freed from the Real', 'Bloom Tender', 'Devoted Druid', 'Hullbreaker Horror',
      'Force of Will', 'Force of Negation', 'Pact of Negation', 'Fierce Guardianship', 'Mana Drain', 'Counterspell', 'Swan Song', 'Flusterstorm',
      'Mystical Tutor', 'Worldly Tutor', 'Survival of the Fittest', 'Finale of Devastation', 'Green Sun\'s Zenith',
      'Rhystic Study', 'Mystic Remora', 'Brainstorm', 'Ponder', 'Preordain',
      'Sol Ring', 'Fellwar Stone', 'Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Lotus Petal', 'Arcane Signet',
      'Birds of Paradise', 'Llanowar Elves', 'Elvish Mystic', 'Fyndhorn Elves', 'Noble Hierarch', 'Delighted Halfling',
      'Command Tower', 'Breeding Pool', 'Tropical Island', 'Yavimaya Coast', 'Misty Rainforest', 'Polluted Delta', 'Flooded Strand',
    ], ['24 Island', '25 Forest']),
  },
  {
    name: 'Kess, Dissident Mage',
    list: deck(['Kess, Dissident Mage'], [
      "Thassa's Oracle", 'Demonic Consultation', 'Tainted Pact', 'Underworld Breach', "Lion's Eye Diamond", 'Brain Freeze',
      'Dark Ritual', 'Cabal Ritual', 'Rite of Flame', 'Demonic Tutor', 'Vampiric Tutor', 'Imperial Seal', 'Mystical Tutor', 'Gamble',
      'Force of Will', 'Pact of Negation', 'Deflecting Swat', 'Fierce Guardianship', 'Mana Drain', 'Counterspell', 'Swan Song', 'Dispel',
      'Rhystic Study', 'Mystic Remora', 'Necropotence', 'Ad Nauseam', 'Brainstorm', 'Ponder', 'Preordain', 'Gitaxian Probe',
      'Sol Ring', 'Grim Monolith', 'Mana Vault', 'Chrome Mox', 'Lotus Petal', 'Arcane Signet', 'Talisman of Dominance', 'Fellwar Stone',
      'Command Tower', 'Underground Sea', 'Volcanic Island', 'Badlands', 'Watery Grave', 'Steam Vents', 'Blood Crypt',
      'Scalding Tarn', 'Polluted Delta', 'Bloodstained Mire',
    ], ['18 Island', '17 Swamp', '16 Mountain']),
  },
  {
    name: 'Thrasios + Tymna',
    list: deck(['Thrasios, Triton Hero', 'Tymna the Weaver'], [
      "Thassa's Oracle", 'Demonic Consultation', 'Tainted Pact', 'Isochron Scepter', 'Dramatic Reversal', 'Exquisite Blood', 'Sanguine Bond',
      'Force of Will', 'Pact of Negation', 'Fierce Guardianship', 'Mana Drain', 'Swan Song', 'Flusterstorm', 'Swords to Plowshares', 'Path to Exile',
      'Demonic Tutor', 'Vampiric Tutor', 'Imperial Seal', 'Enlightened Tutor', 'Worldly Tutor', 'Mystical Tutor',
      'Rhystic Study', 'Mystic Remora', 'Esper Sentinel', 'Smothering Tithe', 'Brainstorm', 'Ponder',
      'Sol Ring', 'Fellwar Stone', 'Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Lotus Petal', 'Arcane Signet', 'Dark Ritual',
      'Birds of Paradise', 'Noble Hierarch', 'Elvish Mystic', 'Bloom Tender', 'Freed from the Real',
      'Command Tower', 'City of Brass', 'Mana Confluence', 'Exotic Orchard', 'Tundra', 'Underground Sea', 'Bayou', 'Savannah', 'Scrubland',
      'Tropical Island', 'Flooded Strand', 'Polluted Delta', 'Misty Rainforest', 'Verdant Catacombs', 'Marsh Flats', 'Windswept Heath',
    ], ['12 Island', '10 Swamp', '10 Plains', '10 Forest']),
  },
  {
    name: 'Heliod, Sun-Crowned',
    list: deck(['Heliod, Sun-Crowned'], [
      'Walking Ballista', 'Drannith Magistrate', 'Esper Sentinel', 'Thalia, Guardian of Thraben', 'Archon of Emeria', 'Grand Abolisher',
      'Ranger-Captain of Eos', 'Restoration Angel', 'Flickerwisp', 'Soul Warden', 'Archangel of Thune', 'Linvala, Keeper of Silence',
      'Swords to Plowshares', 'Path to Exile', 'Ephemerate', 'Teferi\'s Protection', 'Enlightened Tutor', 'Smothering Tithe', 'Silence',
      'Wrath of God', 'Sol Ring', 'Thought Vessel', 'Mana Vault', 'Chrome Mox', 'Lotus Petal', 'Arcane Signet', 'Mind Stone', 'Fellwar Stone',
      'Mother of Runes', 'Giver of Runes', 'Selfless Spirit', 'Serra Ascendant', 'Elite Spellbinder', 'Skyclave Apparition',
      'Kor Skyfisher', 'Stoneforge Mystic', 'Weathered Wayfarer', 'Land Tax',
      'Command Tower', 'Ancient Tomb', 'Urza\'s Saga', 'Eiganjo, Seat of the Empire',
    ], ['57 Plains']),
  },
];
