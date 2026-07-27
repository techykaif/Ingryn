/**
 * Nutrition-table keywords.
 * When multiple of these appear in OCR output, the text likely belongs to
 * a Nutrition Facts panel rather than an ingredient list.
 */
export const NUTRITION_KEYWORDS: string[] = [
  // Headers
  'nutrition facts',
  'nutritional information',
  'nutrition information',
  'nutritional values',
  'supplement facts',
  // Macros
  'calories',
  'energy',
  'protein',
  'total fat',
  'saturated fat',
  'trans fat',
  'cholesterol',
  'sodium',
  'total carbohydrate',
  'carbohydrates',
  'dietary fiber',
  'dietary fibre',
  'total sugars',
  'added sugars',
  // Micro-nutrients
  'vitamin',
  'calcium',
  'iron',
  'potassium',
  'magnesium',
  'zinc',
  // Serving context
  'serving size',
  'servings per container',
  'amount per serving',
  // Daily value
  'daily value',
  '% daily value',
  'percent daily value',
  // Units / formats
  'per 100g',
  'per 100ml',
  'per serving',
  'kcal',
  'kj',
]
