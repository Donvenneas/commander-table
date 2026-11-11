// Interface translations: Spanish, French, German, Portuguese, Italian and Japanese (the last two in i18n_more.js). Text on the page (buttons, labels,
// headings, tooltips, placeholders) is matched by its English wording and replaced, also as new text
// appears (a MutationObserver), so code that writes English keeps working. Longer prompts are matched
// by patterns. The game log and card rules text stay in English; card names and images can come from
// Scryfall in your language in the card preview (cardInLanguage).
import { store, imgUrl } from './util.js';
import { IT_JA, NEW5 } from './i18n_more.js';

export const LANGS = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português', it: 'Italiano', ja: '日本語' };

// English → [es, fr, de, pt]
const T = {
  // top bar and timeline
  'Decks': ['Mazos', 'Decks', 'Decks', 'Decks'],
  'Batch': ['Lote', 'Série', 'Serie', 'Lote'],
  'Tournament': ['Torneo', 'Tournoi', 'Turnier', 'Torneio'],
  'Display': ['Pantalla', 'Affichage', 'Anzeige', 'Exibição'],
  'History': ['Historial', 'Historique', 'Verlauf', 'Histórico'],
  'Progress': ['Progreso', 'Progression', 'Fortschritt', 'Progresso'],
  'Start': ['Empezar', 'Démarrer', 'Starten', 'Iniciar'],
  'Pause': ['Pausa', 'Pause', 'Pause', 'Pausar'],
  'Resume': ['Seguir', 'Reprendre', 'Weiter', 'Continuar'],
  'Step': ['Paso', 'Pas', 'Schritt', 'Passo'],
  'Speed': ['Velocidad', 'Vitesse', 'Tempo', 'Velocidade'],
  'Reveal hands': ['Mostrar manos', 'Montrer les mains', 'Hände zeigen', 'Revelar mãos'],
  'Explain': ['Explicar', 'Expliquer', 'Erklären', 'Explicar'],
  'Follow': ['Seguir', 'Suivre', 'Folgen', 'Acompanhar'],
  'Sound': ['Sonido', 'Son', 'Ton', 'Som'],
  'Stops': ['Paradas', 'Arrêts', 'Stopps', 'Paradas'],
  '⏸ Stops': ['⏸ Paradas', '⏸ Arrêts', '⏸ Stopps', '⏸ Paradas'],
  'Exit': ['Salir', 'Quitter', 'Beenden', 'Sair'],
  'Save replay': ['Guardar repetición', 'Enregistrer la partie', 'Wiederholung speichern', 'Salvar replay'],
  'Export log': ['Exportar registro', 'Exporter le journal', 'Protokoll exportieren', 'Exportar registro'],
  'Share as web page': ['Compartir como página web', 'Partager en page web', 'Als Webseite teilen', 'Compartilhar como página'],
  'Save board as puzzle': ['Guardar tablero como puzle', 'Enregistrer en puzzle', 'Brett als Rätsel speichern', 'Salvar mesa como quebra-cabeça'],
  'Invite': ['Invitar', 'Inviter', 'Einladen', 'Convidar'],
  '↶ Undo': ['↶ Deshacer', '↶ Annuler', '↶ Rückgängig', '↶ Desfazer'],
  'Game log': ['Registro de la partida', 'Journal de partie', 'Spielprotokoll', 'Registro da partida'],
  'Rules': ['Reglas', 'Règles', 'Regeln', 'Regras'],
  'Not started': ['Sin empezar', 'Pas commencé', 'Nicht gestartet', 'Não iniciado'],
  'Load four decks to begin.': ['Carga cuatro mazos para empezar.', 'Chargez quatre decks pour commencer.', 'Lade vier Decks, um zu beginnen.', 'Carregue quatro decks para começar.'],
  // setup screen
  'Seat four decks': ['Sienta cuatro mazos', 'Installez quatre decks', 'Vier Decks platzieren', 'Coloque quatro decks'],
  'Format': ['Formato', 'Format', 'Format', 'Formato'],
  'Match': ['Partida', 'Match', 'Match', 'Partida'],
  'One game': ['Una partida', 'Une partie', 'Ein Spiel', 'Um jogo'],
  'Best of three': ['Al mejor de tres', 'En deux manches gagnantes', 'Best of three', 'Melhor de três'],
  'Ranked': ['Clasificatoria', 'Classé', 'Gewertet', 'Ranqueada'],
  'Fill empty seats with random decks': ['Llenar asientos vacíos con mazos al azar', 'Remplir les places vides au hasard', 'Leere Plätze mit Zufallsdecks füllen', 'Preencher lugares vazios com decks aleatórios'],
  'Seat a cEDH table': ['Mesa de cEDH', 'Table cEDH', 'cEDH-Tisch', 'Mesa de cEDH'],
  'Browse the cEDH meta…': ['Explorar el meta de cEDH…', 'Parcourir le méta cEDH…', 'cEDH-Meta ansehen…', 'Ver o meta de cEDH…'],
  'Bracket for every seat': ['Nivel para todos', 'Niveau pour toutes les places', 'Bracket für alle Plätze', 'Nível para todos'],
  'Random decks': ['Mazos al azar', 'Decks aléatoires', 'Zufallsdecks', 'Decks aleatórios'],
  'Any cards': ['Cualquier carta', 'Toutes les cartes', 'Alle Karten', 'Qualquer carta'],
  'No Reserved List': ['Sin Lista Reservada', 'Sans Liste réservée', 'Ohne Reserved List', 'Sem Lista Reservada'],
  'Commons and uncommons': ['Comunes e infrecuentes', 'Communes et peu communes', 'Commons und Uncommons', 'Comuns e incomuns'],
  'Deal a matched table': ['Repartir una mesa igualada', 'Table équilibrée', 'Ausgeglichener Tisch', 'Mesa equilibrada'],
  'Deck library…': ['Biblioteca de mazos…', 'Bibliothèque de decks…', 'Deck-Bibliothek…', 'Biblioteca de decks…'],
  'Deck library': ['Biblioteca de mazos', 'Bibliothèque de decks', 'Deck-Bibliothek', 'Biblioteca de decks'],
  'Open lobby…': ['Abrir sala…', 'Ouvrir le salon…', 'Lobby öffnen…', 'Abrir sala…'],
  'Puzzles…': ['Puzles…', 'Puzzles…', 'Rätsel…', 'Quebra-cabeças…'],
  'Puzzles': ['Puzles', 'Puzzles', 'Rätsel', 'Quebra-cabeças'],
  'Draft / Sealed…': ['Draft / Sellado…', 'Draft / Scellé…', 'Draft / Sealed…', 'Draft / Selado…'],
  'Draft / Sealed': ['Draft / Sellado', 'Draft / Scellé', 'Draft / Sealed', 'Draft / Selado'],
  'Tour': ['Recorrido', 'Visite', 'Rundgang', 'Tour'],
  'Self-test': ['Autoprueba', 'Autotest', 'Selbsttest', 'Autoteste'],
  'Updates…': ['Actualizaciones…', 'Mises à jour…', 'Updates…', 'Atualizações…'],
  'Updates': ['Actualizaciones', 'Mises à jour', 'Updates', 'Atualizações'],
  'Load replay…': ['Cargar repetición…', 'Charger une partie…', 'Wiederholung laden…', 'Carregar replay…'],
  'Load decks & shuffle up': ['Cargar mazos y barajar', 'Charger et mélanger', 'Decks laden & mischen', 'Carregar decks e embaralhar'],
  'Cancel': ['Cancelar', 'Annuler', 'Abbrechen', 'Cancelar'],
  'Random': ['Al azar', 'Au hasard', 'Zufall', 'Aleatório'],
  'Auto style': ['Estilo automático', 'Style auto', 'Auto-Stil', 'Estilo automático'],
  'You play this seat': ['Juegas tú este asiento', 'Vous jouez cette place', 'Du spielst diesen Platz', 'Você joga este lugar'],
  'A friend plays this seat (online)': ['Un amigo juega este asiento (en línea)', 'Un ami joue cette place (en ligne)', 'Ein Freund spielt (online)', 'Um amigo joga este lugar (online)'],
  'Aggressive': ['Agresivo', 'Agressif', 'Aggressiv', 'Agressivo'],
  'Balanced': ['Equilibrado', 'Équilibré', 'Ausgewogen', 'Equilibrado'],
  'Defensive': ['Defensivo', 'Défensif', 'Defensiv', 'Defensivo'],
  'Combo': ['Combo', 'Combo', 'Combo', 'Combo'],
  'View deck': ['Ver mazo', 'Voir le deck', 'Deck ansehen', 'Ver deck'],
  'Edit': ['Editar', 'Modifier', 'Bearbeiten', 'Editar'],
  'Empty seat — a random deck will be generated.': ['Asiento vacío: se generará un mazo al azar.', 'Place vide : un deck aléatoire sera créé.', 'Leerer Platz: ein Zufallsdeck wird erstellt.', 'Lugar vazio: um deck aleatório será gerado.'],
  'Moxfield links don\'t import? Use this bookmarklet': ['¿No se importan los enlaces de Moxfield? Usa este marcador', 'Les liens Moxfield ne s’importent pas ? Utilisez ce favori', 'Moxfield-Links gehen nicht? Nutze dieses Lesezeichen', 'Links do Moxfield não importam? Use este favorito'],
  // results and matches
  'Rematch': ['Revancha', 'Revanche', 'Revanche', 'Revanche'],
  'New match': ['Nueva partida', 'Nouveau match', 'Neues Match', 'Nova partida'],
  'Next game': ['Siguiente juego', 'Manche suivante', 'Nächstes Spiel', 'Próximo jogo'],
  'Watch replay': ['Ver repetición', 'Revoir la partie', 'Wiederholung ansehen', 'Ver replay'],
  'Change decks': ['Cambiar mazos', 'Changer de decks', 'Decks wechseln', 'Trocar decks'],
  'Sideboard': ['Banquillo', 'Réserve', 'Sideboard', 'Sideboard'],
  'Deck': ['Mazo', 'Deck', 'Deck', 'Deck'],
  'Undo changes': ['Deshacer cambios', 'Annuler les changements', 'Änderungen zurücknehmen', 'Desfazer mudanças'],
  'AI sideboard': ['Banquillo de la IA', 'Réserve par l’IA', 'KI-Sideboard', 'Sideboard da IA'],
  'Play': ['Jugar', 'Jouer', 'Spielen', 'Jogar'],
  'Go first': ['Empezar primero', 'Commencer', 'Anfangen', 'Começar'],
  // board
  'LIFE': ['VIDA', 'VIE', 'LEBEN', 'VIDA'],
  'Library': ['Biblioteca', 'Bibliothèque', 'Bibliothek', 'Grimório'],
  'Graveyard': ['Cementerio', 'Cimetière', 'Friedhof', 'Cemitério'],
  'Exile': ['Exilio', 'Exil', 'Exil', 'Exílio'],
  'Command': ['Mando', 'Commandement', 'Kommandozone', 'Comando'],
  'Hand': ['Mano', 'Main', 'Hand', 'Mão'],
  'Creatures': ['Criaturas', 'Créatures', 'Kreaturen', 'Criaturas'],
  'Lands': ['Tierras', 'Terrains', 'Länder', 'Terrenos'],
  'Artifacts · Enchantments · Planeswalkers': ['Artefactos · Encantamientos · Planeswalkers', 'Artefacts · Enchantements · Planeswalkers', 'Artefakte · Verzauberungen · Planeswalker', 'Artefatos · Encantamentos · Planeswalkers'],
  'Untap': ['Enderezar', 'Dégagement', 'Enttappen', 'Desvirar'],
  'Upkeep': ['Mantenimiento', 'Entretien', 'Versorgung', 'Manutenção'],
  'Draw': ['Robar', 'Pioche', 'Ziehen', 'Compra'],
  'Main 1': ['Principal 1', 'Principale 1', 'Haupt 1', 'Principal 1'],
  'Combat': ['Combate', 'Combat', 'Kampf', 'Combate'],
  'Main 2': ['Principal 2', 'Principale 2', 'Haupt 2', 'Principal 2'],
  'End': ['Final', 'Fin', 'Ende', 'Final'],
  // action bar
  'Pass': ['Pasar', 'Passer', 'Passen', 'Passar'],
  'Keep': ['Quedarse', 'Garder', 'Behalten', 'Manter'],
  'Mulligan': ['Mulligan', 'Mulligan', 'Mulligan', 'Mulligan'],
  'Let the AI decide': ['Que decida la IA', 'Laisser l’IA décider', 'KI entscheiden lassen', 'Deixar a IA decidir'],
  'Let the AI pick': ['Que elija la IA', 'Laisser l’IA choisir', 'KI wählen lassen', 'Deixar a IA escolher'],
  'Let the AI choose': ['Que elija la IA', 'Laisser l’IA choisir', 'KI wählen lassen', 'Deixar a IA escolher'],
  'Let the AI block': ['Que bloquee la IA', 'Laisser l’IA bloquer', 'KI blocken lassen', 'Deixar a IA bloquear'],
  'Let the AI play this phase': ['Que la IA juegue esta fase', 'Laisser l’IA jouer cette phase', 'KI diese Phase spielen lassen', 'Deixar a IA jogar esta fase'],
  'No blocks': ['Sin bloqueos', 'Pas de blocage', 'Keine Blocker', 'Sem bloqueios'],
  'Done blocking': ['Bloqueos listos', 'Blocages terminés', 'Blocken fertig', 'Bloqueios prontos'],
  'No attack': ['Sin ataque', 'Pas d’attaque', 'Kein Angriff', 'Sem ataque'],
  'Select all': ['Seleccionar todo', 'Tout sélectionner', 'Alle wählen', 'Selecionar tudo'],
  'Done': ['Listo', 'Terminé', 'Fertig', 'Pronto'],
  'Accept': ['Aceptar', 'Accepter', 'Annehmen', 'Aceitar'],
  'Decline': ['Rechazar', 'Refuser', 'Ablehnen', 'Recusar'],
  'Tap for mana': ['Girar para maná', 'Engager pour du mana', 'Für Mana tappen', 'Virar para mana'],
  'Other ability': ['Otra habilidad', 'Autre capacité', 'Andere Fähigkeit', 'Outra habilidade'],
  'Use ability': ['Usar habilidad', 'Utiliser la capacité', 'Fähigkeit nutzen', 'Usar habilidade'],
  'Order them for me': ['Ordénalos por mí', 'Ordonner pour moi', 'Für mich ordnen', 'Ordenar por mim'],
  'Keep on top': ['Dejar arriba', 'Garder dessus', 'Oben lassen', 'Manter no topo'],
  'Bottom': ['Al fondo', 'Dessous', 'Unten', 'Embaixo'],
  'No': ['No', 'Non', 'Nein', 'Não'],
  'Repeat ×99': ['Repetir ×99', 'Répéter ×99', '×99 wiederholen', 'Repetir ×99'],
  'Repeat this loop ×10': ['Repetir este bucle ×10', 'Répéter cette boucle ×10', 'Schleife ×10 wiederholen', 'Repetir este loop ×10'],
  "I'm ready": ['Estoy listo', 'Je suis prêt', 'Ich bin bereit', 'Estou pronto'],
  // windows
  'Close': ['Cerrar', 'Fermer', 'Schließen', 'Fechar'],
  'Board background': ['Fondo del tablero', 'Fond du plateau', 'Spielfeld-Hintergrund', 'Fundo da mesa'],
  'Commander art (faint)': ['Arte del comandante (suave)', 'Illustration du commandant (légère)', 'Kommandeur-Bild (blass)', 'Arte do comandante (suave)'],
  'Commander art (bold)': ['Arte del comandante (intenso)', 'Illustration du commandant (vive)', 'Kommandeur-Bild (kräftig)', 'Arte do comandante (forte)'],
  'Green felt': ['Fieltro verde', 'Feutre vert', 'Grüner Filz', 'Feltro verde'],
  'Wood': ['Madera', 'Bois', 'Holz', 'Madeira'],
  'Stone': ['Piedra', 'Pierre', 'Stein', 'Pedra'],
  'Plain': ['Liso', 'Uni', 'Schlicht', 'Liso'],
  'Colors for color blindness': ['Colores para daltonismo', 'Couleurs pour daltoniens', 'Farben bei Farbenblindheit', 'Cores para daltonismo'],
  'Larger text and cards': ['Texto y cartas más grandes', 'Texte et cartes plus grands', 'Größere Schrift und Karten', 'Texto e cartas maiores'],
  'Fewer animations': ['Menos animaciones', 'Moins d’animations', 'Weniger Animationen', 'Menos animações'],
  'Your avatar': ['Tu avatar', 'Votre avatar', 'Dein Avatar', 'Seu avatar'],
  'Card backs': ['Dorsos de carta', 'Dos de carte', 'Kartenrücken', 'Versos de carta'],
  'Language': ['Idioma', 'Langue', 'Sprache', 'Idioma'],
  'Full control': ['Control total', 'Contrôle total', 'Volle Kontrolle', 'Controle total'],
  'Your turn': ['Tu turno', 'Votre tour', 'Dein Zug', 'Seu turno'],
  "Opponents' turns": ['Turnos rivales', 'Tours adverses', 'Gegnerische Züge', 'Turnos dos oponentes'],
  'Draw step': ['Paso de robar', 'Étape de pioche', 'Ziehsegment', 'Etapa de compra'],
  'Beginning of combat': ['Inicio del combate', 'Début du combat', 'Beginn des Kampfes', 'Início do combate'],
  'End step': ['Paso final', 'Étape de fin', 'Endsegment', 'Etapa final'],
  'Ask me to order my triggers when several happen at once': ['Preguntarme el orden de mis disparos simultáneos', 'Me demander l’ordre de mes déclenchements simultanés', 'Reihenfolge gleichzeitiger Auslöser erfragen', 'Perguntar a ordem dos meus gatilhos simultâneos'],
  'Ladder': ['Clasificación', 'Classement', 'Rangliste', 'Ranking'],
  'Challenges': ['Desafíos', 'Défis', 'Herausforderungen', 'Desafios'],
  'Rivals': ['Rivales', 'Rivaux', 'Rivalen', 'Rivais'],
  'Badges': ['Insignias', 'Badges', 'Abzeichen', 'Insígnias'],
  'Your games': ['Tus partidas', 'Vos parties', 'Deine Spiele', 'Seus jogos'],
  'Clear history': ['Borrar historial', 'Effacer l’historique', 'Verlauf löschen', 'Limpar histórico'],
  'Delete': ['Eliminar', 'Supprimer', 'Löschen', 'Excluir'],
  'Run': ['Ejecutar', 'Lancer', 'Ausführen', 'Executar'],
  'Stop': ['Detener', 'Arrêter', 'Stopp', 'Parar'],
  'Open packs': ['Abrir sobres', 'Ouvrir les boosters', 'Booster öffnen', 'Abrir pacotes'],
  'Auto-build': ['Construir solo', 'Construction auto', 'Automatisch bauen', 'Montar automático'],
  'Seat these decks': ['Sentar estos mazos', 'Installer ces decks', 'Diese Decks platzieren', 'Colocar estes decks'],
  'Sealed (6 packs each)': ['Sellado (6 sobres cada uno)', 'Scellé (6 boosters chacun)', 'Sealed (je 6 Booster)', 'Selado (6 pacotes cada)'],
  'Draft (3 packs, 4 players)': ['Draft (3 sobres, 4 jugadores)', 'Draft (3 boosters, 4 joueurs)', 'Draft (3 Booster, 4 Spieler)', 'Draft (3 pacotes, 4 jogadores)'],
  'One on one, best of three': ['Uno contra uno, al mejor de tres', 'Un contre un, deux manches gagnantes', 'Eins gegen eins, Best of three', 'Um contra um, melhor de três'],
  'Commander pod (4 players)': ['Mesa de Commander (4 jugadores)', 'Table Commander (4 joueurs)', 'Commander-Tisch (4 Spieler)', 'Mesa de Commander (4 jogadores)'],
  'A set': ['Una edición', 'Une extension', 'Eine Edition', 'Uma coleção'],
  'A cube': ['Un cubo', 'Un cube', 'Ein Cube', 'Um cubo'],
  'Save cube': ['Guardar cubo', 'Enregistrer le cube', 'Cube speichern', 'Salvar cubo'],
  'Colors': ['Colores', 'Couleurs', 'Farben', 'Cores'],
  'Install': ['Instalar', 'Installer', 'Installieren', 'Instalar'],
  'Download and check': ['Descargar y comprobar', 'Télécharger et vérifier', 'Herunterladen und prüfen', 'Baixar e verificar'],
  'Keep playing': ['Seguir jugando', 'Continuer à jouer', 'Weiterspielen', 'Continuar jogando'],
  'Start a new season': ['Empezar nueva temporada', 'Nouvelle saison', 'Neue Saison starten', 'Iniciar nova temporada'],
  'Nudge': ['Avisar', 'Relancer', 'Anstupsen', 'Cutucar'],
};
// Longer prompts and labels with numbers or names in them
/** @type {[RegExp, (m: RegExpMatchArray, lang: string) => string | null][]} */
const P = [
  [/^Your (first|second) main phase\.$/, (m, l) => ({ es: `Tu ${m[1] === 'first' ? 'primera' : 'segunda'} fase principal.`, fr: `Votre ${m[1] === 'first' ? 'première' : 'seconde'} phase principale.`, de: `Deine ${m[1] === 'first' ? 'erste' : 'zweite'} Hauptphase.`, pt: `Sua ${m[1] === 'first' ? 'primeira' : 'segunda'} fase principal.`, it: `La tua ${m[1] === 'first' ? 'prima' : 'seconda'} fase principale.`, ja: `あなたの${m[1] === 'first' ? '第1' : '第2'}メイン・フェイズ。` })[l]],
  [/^Go to combat( \((\d+) playable\))?$/, (m, l) => ({ es: 'Ir al combate', fr: 'Aller au combat', de: 'Zum Kampf', pt: 'Ir para o combate', it: 'Vai al combattimento', ja: '戦闘へ' })[l] + (m[2] ? ` (${m[2]})` : '')],
  [/^End turn( \((\d+) playable\))?$/, (m, l) => ({ es: 'Terminar turno', fr: 'Finir le tour', de: 'Zug beenden', pt: 'Encerrar turno', it: 'Fine turno', ja: 'ターン終了' })[l] + (m[2] ? ` (${m[2]})` : '')],
  [/^Attack (.+)$/, (m, l) => ({ es: `Atacar a ${m[1]}`, fr: `Attaquer ${m[1]}`, de: `${m[1]} angreifen`, pt: `Atacar ${m[1]}`, it: `Attacca ${m[1]}`, ja: `${m[1]}を攻撃` })[l]],
  [/^Turn (\d+) · step (\d+)(?: of (\d+))?(.*)$/, (m, l) => `${({ es: 'Turno', fr: 'Tour', de: 'Zug', pt: 'Turno', it: 'Turno', ja: 'ターン' })[l]} ${m[1]} · ${({ es: 'paso', fr: 'étape', de: 'Schritt', pt: 'passo', it: 'passo', ja: 'ステップ' })[l]} ${m[2]}${m[3] ? ` / ${m[3]}` : ''}${m[4]}`],
  [/^Seat two (.+) decks$/, (m, l) => ({ es: `Sienta dos mazos de ${m[1]}`, fr: `Installez deux decks ${m[1]}`, de: `Zwei ${m[1]}-Decks platzieren`, pt: `Coloque dois decks de ${m[1]}`, it: `Siedi due mazzi ${m[1]}`, ja: `${m[1]}のデッキを2つ着席` })[l]],
  [/^Hand · (\d+)$/, (m, l) => `${({ es: 'Mano', fr: 'Main', de: 'Hand', pt: 'Mão', it: 'Mano', ja: '手札' })[l]} · ${m[1]}`],
  [/^Your hand$/, (m, l) => ({ es: 'Tu mano', fr: 'Votre main', de: 'Deine Hand', pt: 'Sua mão', it: 'La tua mano', ja: 'あなたの手札' })[l]],
  [/^(.+) wins!$/, (m, l) => ({ es: `¡${m[1]} gana!`, fr: `${m[1]} gagne !`, de: `${m[1]} gewinnt!`, pt: `${m[1]} vence!`, it: `${m[1]} vince!`, ja: `${m[1]}の勝利！` })[l]],
];

let lang = 'en';
export const currentLang = () => lang;
export function t(s) {
  const k = s.trim();
  if (lang === 'en' || !k) return s;
  const i = { es: 0, fr: 1, de: 2, pt: 3, it: 4, ja: 5 }[lang];
  // (Italian and Japanese, and the Round 5 labels: i18n_more.js)
  const hit = (i < 4 ? T[k]?.[i] : IT_JA[k]?.[i - 4]) || NEW5[k]?.[i];
  if (hit) return s.replace(k, hit);
  for (const [re, f] of P) { const m = k.match(re); if (m) { const v = f(m, lang); if (v) return s.replace(k, v); } }
  return s;
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'data-label'];
function translateTree(root) {
  if (lang === 'en' || !root) return;
  if (root.nodeType === 3) { const v = t(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; return; }
  if (root.nodeType !== 1 || root.closest?.('#log, .oracle, .ptext h3, .lim-name, .cn, textarea, .no-i18n')) return;
  for (const a of ATTRS) if (root.hasAttribute?.(a)) { const v = t(root.getAttribute(a)); if (v !== root.getAttribute(a)) root.setAttribute(a, v); }
  for (const c of root.childNodes) translateTree(c);
}
// Turn translation on for this page (call once, at startup)
export function startI18n(code) {
  lang = LANGS[code] ? code : 'en';
  document.documentElement.lang = lang;
  if (lang === 'en') return;
  translateTree(document.body);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') translateTree(m.target);
      else if (m.type === 'attributes') translateTree(m.target);
      else m.addedNodes.forEach(translateTree);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

// A card's name and image in your language, from Scryfall (null when it has no printing in it).
// Looked up when you preview the card, then remembered in the browser profile.
const CACHE = 'ct.i18nCards2';
const mem = store(CACHE) || {};
export async function cardInLanguage(card) {
  if (lang === 'en' || !card?.name) return null;
  const key = `${lang}:${card.name}`;
  if (key in mem) return mem[key];
  let out = null;
  try {
    const r = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(`!"${card.name.split(' // ')[0]}" lang:${lang}`)}&unique=prints&include_multilingual=true`, { headers: { Accept: 'application/json' } });
    if (r.ok) {
      // Special printings can carry another name (a story name, a crossover): use the name most of the
      // regular printings in that language agree on, and an image of one of those
      const nameOf = c => c.printed_name || c.card_faces?.[0]?.printed_name || null;
      const all = ((await r.json()).data || []).filter(c => c.lang === lang && nameOf(c));
      const regular = all.filter(c => !c.promo && !c.flavor_name && ['core', 'expansion', 'masters', 'draft_innovation', 'commander', 'starter', 'duel_deck'].includes(c.set_type));
      const pool = regular.length ? regular : all;
      const count = new Map();
      for (const c of pool) count.set(nameOf(c), (count.get(nameOf(c)) || 0) + 1);
      const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
      const c = pool.find(x => nameOf(x) === best);
      const img = c?.image_uris?.normal || c?.card_faces?.[0]?.image_uris?.normal;
      if (c) out = { name: best, img: img ? imgUrl(img) : null };
    } else if (r.status === 404) out = null;
    else return null;
  } catch { return null; }
  mem[key] = out;
  const keys = Object.keys(mem);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete mem[k];
  store(CACHE, mem);
  return out;
}
