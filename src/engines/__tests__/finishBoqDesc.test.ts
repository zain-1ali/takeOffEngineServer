import {
  ceilingAreaBoqDesc,
  finishBoqDesc,
  floorAreaBoqDesc,
  floorScreedBoqDesc,
  floorTilesBoqDesc,
  wallAreaBoqDesc,
} from '../../services/reports/finishBoqDesc';

describe('finishBoqDesc templates', () => {
  it('floor screed/tiles match starting client wording', () => {
    expect(floorScreedBoqDesc(0.05)).toBe(
      'Cement and sand screed to floor, 50mm thick, to receive tiling',
    );
    expect(floorTilesBoqDesc('Cement screed + ceramic tiles')).toBe(
      'Ceramic floor tiles, bedded and pointed in cement mortar',
    );
    expect(floorTilesBoqDesc('Cement screed + porcelain tiles')).toBe(
      'Porcelain floor tiles, bedded and pointed in cement mortar',
    );
  });

  it('maps each finish dropdown spec to trade wording', () => {
    expect(floorAreaBoqDesc('Granolithic screed', 0.05)).toMatch(/Granolithic/);
    expect(floorAreaBoqDesc('Terrazzo')).toMatch(/Terrazzo/);
    expect(floorAreaBoqDesc('Vinyl on screed', 0.05)).toMatch(/Vinyl/);

    expect(wallAreaBoqDesc('Cement/sand plaster + emulsion paint')).toMatch(
      /Cement and sand plaster/,
    );
    expect(wallAreaBoqDesc('Gypsum plaster + emulsion')).toMatch(/Gypsum plaster/);
    expect(wallAreaBoqDesc('Ceramic wall tiles')).toMatch(/Ceramic wall tiles/);
    expect(wallAreaBoqDesc('Fair-face (paint only)')).toMatch(/fair-face/i);

    expect(ceilingAreaBoqDesc('Plaster + emulsion paint')).toMatch(/Plaster to soffits/);
    expect(ceilingAreaBoqDesc('Suspended grid (mineral tile)')).toMatch(/Suspended ceiling/);
    expect(ceilingAreaBoqDesc('Gypsum board + skim + paint')).toMatch(/Gypsum board/);
    expect(ceilingAreaBoqDesc('PVC panel')).toMatch(/PVC panel/);
  });

  it('finishBoqDesc never embeds element label or room', () => {
    const d = finishBoqDesc('FLOOR', 'Cement screed + ceramic tiles', {
      part: 'screed',
      screedThicknessM: 0.05,
    });
    expect(d).not.toMatch(/Floor Finishes|ROOM/i);
  });
});
