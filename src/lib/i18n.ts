import { useStore } from '../store'

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'hi', label: 'हिन्दी' },
] as const
export type Lang = (typeof LANGUAGES)[number]['id']

type Dict = Record<string, string>

const es: Dict = {
  Surfaces: 'Superficies',
  Sparkles: 'Destellos',
  Undo: 'Deshacer', Redo: 'Rehacer', Reset: 'Restablecer', Random: 'Aleatorio', Compare: 'Comparar', Lighting: 'Iluminación', Save: 'Guardar',
  Catalogs: 'Catálogos', Cart: 'Carrito', Share: 'Compartir', Download: 'Descargar', More: 'Más', 'Change room': 'Cambiar sala',
  'Get in touch': 'Contáctanos', 'Add to Selection': 'Añadir a selección', Tiles: 'Azulejos', Paint: 'Pintura', 'My Upload': 'Mis archivos',
  Applied: 'Aplicados', 'Surface:': 'Superficie:', Floor: 'Suelo', Wall: 'Pared', Walls: 'Paredes', Ceiling: 'Techo', Rug: 'Alfombra',
  'Counter Top': 'Encimera', Backsplash: 'Salpicadero', 'Wall + Floor': 'Pared + Suelo', 'Search name, SKU, material…': 'Buscar nombre, SKU, material…',
  products: 'productos', 'Applied products': 'Productos aplicados', Summary: 'Resumen', 'Add to catalog': 'Añadir al catálogo', Settings: 'Ajustes',
  Layout: 'Diseño', Rotation: 'Rotación', 'Grout size': 'Tamaño de junta', 'Grout colour': 'Color de junta', 'Surface finish': 'Acabado',
  Glossy: 'Brillo', Matt: 'Mate', 'Select a room for': 'Selecciona una sala para', transformation: 'transformar', 'Demo rooms': 'Salas de demostración',
  'Rate your experience': 'Valora tu experiencia', Language: 'Idioma', 'No rug': 'Sin alfombra',
}
const fr: Dict = {
  Surfaces: 'Surfaces',
  Sparkles: 'Paillettes',
  Undo: 'Annuler', Redo: 'Rétablir', Reset: 'Réinitialiser', Random: 'Aléatoire', Compare: 'Comparer', Lighting: 'Éclairage', Save: 'Enregistrer',
  Catalogs: 'Catalogues', Cart: 'Panier', Share: 'Partager', Download: 'Télécharger', More: 'Plus', 'Change room': 'Changer de pièce',
  'Get in touch': 'Nous contacter', 'Add to Selection': 'Ajouter à la sélection', Tiles: 'Carreaux', Paint: 'Peinture', 'My Upload': 'Mes imports',
  Applied: 'Appliqués', 'Surface:': 'Surface :', Floor: 'Sol', Wall: 'Mur', Walls: 'Murs', Ceiling: 'Plafond', Rug: 'Tapis',
  'Counter Top': 'Plan de travail', Backsplash: 'Crédence', 'Wall + Floor': 'Mur + Sol', 'Search name, SKU, material…': 'Rechercher nom, réf., matière…',
  products: 'produits', 'Applied products': 'Produits appliqués', Summary: 'Récapitulatif', 'Add to catalog': 'Ajouter au catalogue', Settings: 'Réglages',
  Layout: 'Pose', Rotation: 'Rotation', 'Grout size': 'Largeur de joint', 'Grout colour': 'Couleur de joint', 'Surface finish': 'Finition',
  Glossy: 'Brillant', Matt: 'Mat', 'Select a room for': 'Choisissez une pièce à', transformation: 'transformer', 'Demo rooms': 'Pièces de démonstration',
  'Rate your experience': 'Notez votre expérience', Language: 'Langue', 'No rug': 'Sans tapis',
}
const de: Dict = {
  Surfaces: 'Flächen',
  Sparkles: 'Glitzer',
  Undo: 'Rückgängig', Redo: 'Wiederholen', Reset: 'Zurücksetzen', Random: 'Zufall', Compare: 'Vergleichen', Lighting: 'Licht', Save: 'Speichern',
  Catalogs: 'Kataloge', Cart: 'Warenkorb', Share: 'Teilen', Download: 'Download', More: 'Mehr', 'Change room': 'Raum wechseln',
  'Get in touch': 'Kontakt', 'Add to Selection': 'Zur Auswahl', Tiles: 'Fliesen', Paint: 'Farbe', 'My Upload': 'Meine Uploads',
  Applied: 'Angewendet', 'Surface:': 'Fläche:', Floor: 'Boden', Wall: 'Wand', Walls: 'Wände', Ceiling: 'Decke', Rug: 'Teppich',
  'Counter Top': 'Arbeitsplatte', Backsplash: 'Fliesenspiegel', 'Wall + Floor': 'Wand + Boden', 'Search name, SKU, material…': 'Name, Art.-Nr., Material suchen…',
  products: 'Produkte', 'Applied products': 'Angewendete Produkte', Summary: 'Übersicht', 'Add to catalog': 'Zum Katalog', Settings: 'Einstellungen',
  Layout: 'Verlegung', Rotation: 'Drehung', 'Grout size': 'Fugenbreite', 'Grout colour': 'Fugenfarbe', 'Surface finish': 'Oberfläche',
  Glossy: 'Glänzend', Matt: 'Matt', 'Select a room for': 'Wählen Sie einen Raum zur', transformation: 'Umgestaltung', 'Demo rooms': 'Demo-Räume',
  'Rate your experience': 'Bewerten Sie uns', Language: 'Sprache', 'No rug': 'Kein Teppich',
}
const hi: Dict = {
  Surfaces: 'सतहें',
  Sparkles: 'चमक',
  Undo: 'पूर्ववत', Redo: 'फिर से', Reset: 'रीसेट', Random: 'रैंडम', Compare: 'तुलना', Lighting: 'रोशनी', Save: 'सहेजें',
  Catalogs: 'कैटलॉग', Cart: 'कार्ट', Share: 'शेयर', Download: 'डाउनलोड', More: 'अधिक', 'Change room': 'कमरा बदलें',
  'Get in touch': 'संपर्क करें', 'Add to Selection': 'चयन में जोड़ें', Tiles: 'टाइल्स', Paint: 'पेंट', 'My Upload': 'मेरे अपलोड',
  Applied: 'लगाए गए', 'Surface:': 'सतह:', Floor: 'फ़र्श', Wall: 'दीवार', Walls: 'दीवारें', Ceiling: 'छत', Rug: 'कालीन',
  'Counter Top': 'काउंटर टॉप', Backsplash: 'बैकस्प्लैश', 'Wall + Floor': 'दीवार + फ़र्श', 'Search name, SKU, material…': 'नाम, SKU, सामग्री खोजें…',
  products: 'उत्पाद', 'Applied products': 'लगाए गए उत्पाद', Summary: 'सारांश', 'Add to catalog': 'कैटलॉग में जोड़ें', Settings: 'सेटिंग्स',
  Layout: 'लेआउट', Rotation: 'घुमाव', 'Grout size': 'ग्राउट चौड़ाई', 'Grout colour': 'ग्राउट रंग', 'Surface finish': 'फ़िनिश',
  Glossy: 'ग्लॉसी', Matt: 'मैट', 'Select a room for': 'बदलाव के लिए', transformation: 'कमरा चुनें', 'Demo rooms': 'डेमो कमरे',
  'Rate your experience': 'अपना अनुभव रेट करें', Language: 'भाषा', 'No rug': 'कालीन नहीं',
}
const DICTS: Record<Lang, Dict> = { en: {}, es, fr, de, hi }

/** Translate a UI string (English is the key; missing entries fall back to English). */
export const translate = (lang: Lang, s: string) => DICTS[lang]?.[s] ?? s
export const useT = () => {
  const lang = useStore((s) => s.lang)
  return (s: string) => translate(lang, s)
}
