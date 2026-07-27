/**
 * Common ingredient names for fuzzy matching.
 * The DetectionEngine fuzzy-matches OCR words against this database
 * to score how likely the text is an ingredient list.
 *
 * E-number and INS-code detection is handled via regex patterns
 * in DetectionEngine, not listed here.
 */
export const COMMON_INGREDIENTS: string[] = [
  // ── Sweeteners ──
  'sugar', 'sucrose', 'glucose', 'fructose', 'dextrose', 'maltose',
  'corn syrup', 'high fructose corn syrup', 'honey', 'molasses',
  'aspartame', 'sucralose', 'stevia', 'saccharin', 'acesulfame',
  'sorbitol', 'mannitol', 'xylitol', 'erythritol', 'maltitol',
  'maltodextrin', 'invert sugar', 'agave', 'coconut sugar', 'jaggery',
  'isomalt', 'trehalose',

  // ── Oils & Fats ──
  'palm oil', 'coconut oil', 'sunflower oil', 'soybean oil',
  'canola oil', 'olive oil', 'vegetable oil', 'rapeseed oil',
  'palm kernel oil', 'cottonseed oil', 'corn oil', 'peanut oil',
  'sesame oil', 'rice bran oil', 'mustard oil', 'safflower oil',
  'hydrogenated oil', 'partially hydrogenated oil',
  'butter', 'ghee', 'lard', 'shortening', 'margarine', 'cocoa butter',
  'interesterified fat',

  // ── Dairy ──
  'milk', 'whole milk', 'skim milk', 'milk powder', 'milk solids',
  'cream', 'whey', 'whey protein', 'casein', 'lactose',
  'cheese', 'buttermilk', 'yogurt', 'condensed milk',
  'milk protein concentrate', 'whey protein isolate',

  // ── Grains & Starches ──
  'wheat flour', 'refined wheat flour', 'maida', 'corn starch',
  'rice flour', 'oat flour', 'barley', 'rye', 'semolina',
  'starch', 'modified starch', 'tapioca starch', 'potato starch',
  'corn flour', 'gram flour', 'soy flour', 'modified food starch',

  // ── Proteins ──
  'soy protein', 'whey protein', 'gelatin', 'collagen',
  'pea protein', 'egg', 'egg white', 'egg yolk',
  'albumin', 'gluten', 'wheat gluten',

  // ── Acids ──
  'citric acid', 'lactic acid', 'acetic acid', 'phosphoric acid',
  'malic acid', 'tartaric acid', 'fumaric acid', 'ascorbic acid',
  'sorbic acid', 'benzoic acid', 'propionic acid', 'adipic acid',

  // ── Preservatives ──
  'sodium benzoate', 'potassium sorbate', 'sodium metabisulphite',
  'calcium propionate', 'sodium nitrite', 'sodium nitrate',
  'bht', 'bha', 'tbhq', 'sodium bisulphite',
  'potassium metabisulphite', 'nisin', 'natamycin',

  // ── Emulsifiers ──
  'lecithin', 'soy lecithin', 'sunflower lecithin',
  'mono and diglycerides', 'polysorbate 80', 'polysorbate 60',
  'sodium stearoyl lactylate', 'glycerol monostearate',
  'polyglycerol esters',

  // ── Stabilizers & Thickeners ──
  'xanthan gum', 'guar gum', 'gellan gum', 'locust bean gum',
  'carrageenan', 'pectin', 'agar', 'cellulose',
  'microcrystalline cellulose', 'carboxymethyl cellulose',
  'methylcellulose', 'sodium alginate', 'arabic gum',
  'tara gum', 'konjac', 'tragacanth',

  // ── Flavoring ──
  'natural flavors', 'natural flavours', 'artificial flavors',
  'artificial flavours', 'vanilla', 'vanillin',
  'monosodium glutamate', 'msg', 'yeast extract',
  'hydrolyzed protein', 'smoke flavor', 'diacetyl',

  // ── Colors ──
  'caramel color', 'caramel colour', 'annatto',
  'beta carotene', 'paprika extract', 'turmeric',
  'titanium dioxide', 'carbon black', 'riboflavin',
  'tartrazine', 'sunset yellow', 'allura red',
  'brilliant blue', 'indigo carmine', 'chlorophyll',

  // ── Minerals & Vitamins ──
  'salt', 'sodium chloride', 'calcium carbonate',
  'ferrous sulfate', 'zinc oxide', 'magnesium carbonate',
  'vitamin a', 'vitamin b', 'vitamin c', 'vitamin d',
  'vitamin e', 'vitamin k', 'thiamine', 'niacin',
  'folic acid', 'biotin', 'pantothenic acid', 'pyridoxine',
  'cyanocobalamin', 'retinol', 'tocopherol',

  // ── Leavening ──
  'baking soda', 'sodium bicarbonate', 'baking powder',
  'yeast', 'ammonium bicarbonate',

  // ── Common whole foods / spices ──
  'water', 'spices', 'herbs', 'garlic', 'onion', 'ginger',
  'pepper', 'chili', 'cinnamon', 'cardamom', 'cumin',
  'coriander', 'mustard', 'clove', 'nutmeg', 'turmeric',
  'vinegar', 'soy sauce', 'tomato', 'cocoa', 'chocolate',
  'coffee', 'tea', 'lemon', 'lime',

  // ── Functional terms (often part of ingredient text) ──
  'emulsifier', 'stabilizer', 'stabiliser', 'preservative',
  'antioxidant', 'acidity regulator', 'anticaking agent',
  'humectant', 'sequestrant', 'thickener', 'raising agent',
  'flavour enhancer', 'flavor enhancer', 'bulking agent',
  'glazing agent', 'firming agent', 'gelling agent',
  'release agent', 'foaming agent',
]

/**
 * Pre-built Set for O(1) exact lookups (lowercase).
 * The FuzzyMatcher handles OCR error tolerance separately.
 */
export const INGREDIENT_SET = new Set(COMMON_INGREDIENTS)
