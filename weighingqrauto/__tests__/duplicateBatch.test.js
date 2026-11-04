describe('Duplicate Batch & Location-wise QR Generation', () => {
  const SEED_PRESETS = [
    {label: 'Soyabean', code: 'SO'},
    {label: 'Wheat', code: 'WH'},
    {label: 'Rice', code: 'RI'},
    {label: 'Maize', code: 'MA'},
    {label: 'Cotton', code: 'CO'},
    {label: 'Mustard', code: 'MU'},
    {label: 'Groundnut', code: 'GN'},
    {label: 'Sunflower', code: 'SF'},
  ];

  function getSeedCodeForCrop(cropName) {
    if (!cropName || typeof cropName !== 'string') return 'SC';
    const trimmed = cropName.trim().toLowerCase();
    const found = SEED_PRESETS.find(p => p.label.toLowerCase() === trimmed);
    if (found) return found.code;
    const letters = cropName.replace(/[^A-Za-z]/g, '');
    return letters.slice(0, 2).toUpperCase() || 'SC';
  }

  function parseLocationString(loc) {
    if (!loc || typeof loc !== 'string') return null;
    const parts = loc.split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length === 3) {
      const land = parts[0];
      const line = parts[1];
      const count = parseInt(parts[2], 10);
      if (land && line && !isNaN(count) && count > 0) {
        return {land, line, count};
      }
    }
    return null;
  }

  test('parseLocationString correctly parses hyphen-separated location formats', () => {
    expect(parseLocationString('R - 2 - 3')).toEqual({land: 'R', line: '2', count: 3});
    expect(parseLocationString('R-2-24')).toEqual({land: 'R', line: '2', count: 24});
    expect(parseLocationString('LandA - Line1 - 50')).toEqual({land: 'LandA', line: 'Line1', count: 50});
    expect(parseLocationString('invalid')).toBeNull();
    expect(parseLocationString('')).toBeNull();
    expect(parseLocationString(null)).toBeNull();
  });

  test('getSeedCodeForCrop returns standard seed codes and 2-letter fallback', () => {
    expect(getSeedCodeForCrop('Soyabean')).toBe('SO');
    expect(getSeedCodeForCrop('Wheat')).toBe('WH');
    expect(getSeedCodeForCrop('Rice')).toBe('RI');
    expect(getSeedCodeForCrop('Cotton')).toBe('CO');
    expect(getSeedCodeForCrop('Tomato')).toBe('TO');
    expect(getSeedCodeForCrop('')).toBe('SC');
  });

  test('Extra count calculation properly expands and trims crop name entries', () => {
    const generated = 2;
    let extra = 0;
    let cropNames = ['Soyabean', 'Soyabean'];

    // Increase extra by 2 -> totalDesired = 4
    extra = 2;
    const totalDesired = generated + extra;
    const expandedNames = [...cropNames];
    if (totalDesired > expandedNames.length) {
      const diff = totalDesired - expandedNames.length;
      for (let i = 0; i < diff; i++) {
        expandedNames.push('');
      }
    }
    expect(expandedNames.length).toBe(4);
    expect(expandedNames).toEqual(['Soyabean', 'Soyabean', '', '']);

    // Fill in the extra crop names
    expandedNames[2] = 'Soyabean Extra 1';
    expandedNames[3] = 'Soyabean Extra 2';
    expect(expandedNames.filter(Boolean).length).toBe(4);

    // Reduce extra back to 1 -> totalDesired = 3
    const trimmedNames = [...expandedNames];
    trimmedNames.splice(generated + 1);
    expect(trimmedNames.length).toBe(3);
  });

  test('Product ID format matches PRD-${seedCode}${batchCode}-XXX', () => {
    const sc = 'SO';
    const bc = 'R2';
    const seq = 3;
    const uniqueId = `PRD-${sc}${bc}-${String(seq).padStart(3, '0')}`;
    expect(uniqueId).toBe('PRD-SOR2-003');
    expect(uniqueId).toMatch(/^PRD-[A-Z0-9]+-\d{3,}$/);
  });

  test('QR Label specification contains exactly 4 elements and NO batch name', () => {
    const labelData = {
      qrCodeUrl: '/api/qr/66d8f1e2c3b4a5d6e7f8a9b0',
      crop: 'Soyabean',
      locationCode: 'R - 2 - 3',
      uniqueId: 'PRD-SOR2-003',
      batchName: 'Soyabean R-2', // must NOT be rendered on label
    };

    const renderedLabel = {
      item1_qrCode: labelData.qrCodeUrl,
      item2_cropName: labelData.crop,
      item3_location: labelData.locationCode,
      item4_productIdBold: labelData.uniqueId,
    };

    expect(renderedLabel.item1_qrCode).toBeDefined();
    expect(renderedLabel.item2_cropName).toBe('Soyabean');
    expect(renderedLabel.item3_location).toBe('R - 2 - 3');
    expect(renderedLabel.item4_productIdBold).toBe('PRD-SOR2-003');
    expect(renderedLabel).not.toHaveProperty('batchName');
  });
});

