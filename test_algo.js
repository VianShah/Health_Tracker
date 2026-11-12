const BN_SHOP_PRODUCTS = [
    { name: "BN – Hot n Tangy Roasted Chana", slug: "bn-hot-n-tangy-roasted-chana", categories: ["Nut Free", "Gluten Free", "Soy Free"], types: ["snack"] },
    { name: "BN – Roasted Makhana (Hot'n'Tangy)", slug: "bn-roasted-makhana-hotntangy", categories: ["Nut Free", "Gluten Free"], types: ["snack"] },
    { name: "BN – Hot n Tangy Seeds", slug: "bn-hot-n-tangy-seeds", categories: ["Nut Free", "Gluten Free"], types: ["snack"] },
    { name: "BN-Almond Berry Dessert Cookies", slug: "bn-almond-berry-dessert-cookies", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["cookies"] },
    { name: "BN-Dark Chocolate Cookies", slug: "bn-dark-chocolate-cookies", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["cookies"] },
    { name: "BN-Makhana Chips", slug: "bn-makhana-chips", categories: ["Gluten Free", "Lactose Free", "Soy Free"], types: ["snack"] },
    { name: "BN – Roasti Jowar Stix (Sour Cream)", slug: "bn-roasti-jowar-stix-sour-cream", categories: ["Gluten Free", "Soy Free"], types: ["snack"] }
];

function getBNAlternatives(profile, itemName = '', lifestyleCategory = 'Others', count = 2) {
    const nameLower = (itemName || '').toLowerCase();
    const rawAllergies = profile.allergies || [];
    const allergies = (Array.isArray(rawAllergies) ? rawAllergies : [rawAllergies]).map(a => a.toLowerCase());
    const rawAversions = profile.aversions || [];
    const aversions = (Array.isArray(rawAversions) ? rawAversions : [rawAversions]).map(a => a.toLowerCase());
    const activeCatalog = BN_SHOP_PRODUCTS;
    const itemTokens = nameLower.split(/[\s-]+/);
    
    let candidates = activeCatalog.map(p => {
        const productTags = (p.categories || []).map(c => c.toLowerCase());
        const productNameLower = p.name.toLowerCase();
        
        if (allergies.some(a => a.includes('gluten') || a.includes('celiac')) && !productTags.includes('gluten free')) return null;
        if (allergies.some(a => a.includes('nut') || a.includes('peanut') || a.includes('almond')) && !productTags.includes('nut free')) return null;
        if (allergies.some(a => a.includes('dairy') || a.includes('lactose') || a.includes('milk')) && !productTags.includes('lactose free') && !productTags.includes('dairy free')) return null;
        if (allergies.some(a => a.includes('soy')) && !productTags.includes('soy free')) return null;
        if (aversions.some(av => productNameLower.includes(av))) return null;
        
        const isOilOrCombo = (p.types || []).includes('oil') || (p.types || []).includes('combo');
        if (isOilOrCombo && !nameLower.includes('oil') && !nameLower.includes('combo')) return null;

        let score = 1; 
        
        itemTokens.forEach(token => {
            if (token.length > 2 && productNameLower.includes(token)) score += 15;
            if (['sweet', 'biscuit', 'cookie', 'dessert', 'chocolate'].includes(token) && (p.types || []).includes('cookies')) score += 15;
            if (['snack', 'chips', 'fry', 'namkeen', 'puff', 'stix', 'chivda', 'wafer', 'kurkure', 'bhujia', 'farsan'].includes(token) && (p.types || []).includes('snack')) score += 15;
        });
        
        let targetType = null;
        if (nameLower.includes('protein') || nameLower.includes('isolate')) targetType = 'protein';
        else if (['snack', 'chip', 'fry', 'namkeen', 'wafer', 'kurkure', 'bhujia', 'farsan'].some(kw => nameLower.includes(kw))) targetType = 'snack';
        else if (['biscuit', 'cookie', 'sweet', 'dessert'].some(kw => nameLower.includes(kw))) targetType = 'cookies';
        else if (['breakfast', 'cereal', 'upma', 'poha', 'oat'].some(kw => nameLower.includes(kw))) targetType = 'breakfast';
        else if (lifestyleCategory === 'Packaged Goods') targetType = 'snack';
        else if (lifestyleCategory === 'Sweets/Candies') targetType = 'cookies';
        else if (lifestyleCategory === 'Proteins') targetType = 'protein';
        else if (lifestyleCategory === 'Daily Groceries') targetType = 'breakfast';
        
        if (targetType && (p.types || []).includes(targetType)) score += 10;
        
        if (productNameLower.includes('makhana') || productNameLower.includes('jowar') || productNameLower.includes('nippat')) score += 2;

        return { name: p.name, score, type: p.types[0], productTags };
    }).filter(p => p !== null);

    console.log("SCORED CANDIDATES:\n", candidates);

    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, count);
}

console.log("----- Test 1: No allergy, Sweets / Candies -----");
console.log(getBNAlternatives({allergies: []}, "chocolate brownie", "Sweets/Candies", 2));

console.log("----- Test 2: 'Nut' allergy, Sweets / Candies -----");
console.log(getBNAlternatives({allergies: ["nuts"]}, "chocolate brownie", "Sweets/Candies", 2));
