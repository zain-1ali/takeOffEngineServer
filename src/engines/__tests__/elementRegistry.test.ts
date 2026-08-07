import { ELEMENT_ENGINES } from '../../elementEngines';
import {
  calcFinish,
  calcFooting,
  calcStone,
  calcStrip,
  calcWall,
} from '..';

describe('ELEMENT_ENGINES Phase 1 migration', () => {
  it('keeps all Phase 1 calculation outputs byte-for-byte equivalent', () => {
    const cases: {
      key: string;
      input: Record<string, unknown>;
      materials?: Record<string, unknown>;
      direct: () => unknown;
    }[] = [
      {
        key: 'PAD_FOOTING',
        input: {
          shape: 'RECTANGULAR',
          length: 2,
          width: 2,
          baseThickness: 0.6,
          cover: 50,
          bottomMainDia: 16,
          bottomMainSpacing: 150,
          bottomDistDia: 16,
          bottomDistSpacing: 150,
        },
        direct: () =>
          calcFooting({
            shape: 'RECTANGULAR',
            length: 2,
            width: 2,
            baseThickness: 0.6,
            cover: 50,
            bottomMainDia: 16,
            bottomMainSpacing: 150,
            bottomDistDia: 16,
            bottomDistSpacing: 150,
          }),
      },
      {
        key: 'STRIP_FOOTING',
        input: {
          shape: 'FLAT',
          length: 24,
          width: 0.6,
          height: 0.3,
          cover: 50,
          mainDia: 12,
          mainSpacing: 150,
          distDia: 12,
          distSpacing: 250,
        },
        direct: () =>
          calcStrip({
            shape: 'FLAT',
            length: 24,
            width: 0.6,
            height: 0.3,
            cover: 50,
            mainDia: 12,
            mainSpacing: 150,
            distDia: 12,
            distSpacing: 250,
          }),
      },
      {
        key: 'WALLS',
        input: {
          shape: 'LINEAR',
          length: 8,
          thickness: 0.25,
          height: 3.5,
          cover: 40,
          vertDia: 12,
          vertSpacing: 200,
          horizDia: 12,
          horizSpacing: 250,
          bothFaces: true,
        },
        direct: () =>
          calcWall({
            shape: 'LINEAR',
            length: 8,
            thickness: 0.25,
            height: 3.5,
            cover: 40,
            vertDia: 12,
            vertSpacing: 200,
            horizDia: 12,
            horizSpacing: 250,
            bothFaces: true,
          }),
      },
      {
        key: 'STONE_STRIP',
        input: {
          shape: 'RECTANGULAR',
          length: 18,
          width: 0.5,
          height: 0.5,
          hasBlinding: false,
        },
        direct: () =>
          calcStone({
            shape: 'RECTANGULAR',
            length: 18,
            width: 0.5,
            height: 0.5,
            hasBlinding: false,
          }),
      },
      ...(['FLOOR', 'WALL', 'CEILING'] as const).map((kind) => {
        const key = `${kind}_FINISH`;
        const input =
          kind === 'WALL'
            ? { wallLength: 10, wallHeight: 3, openingArea: 2, count: 1, spec: 'Paint' }
            : { roomLength: 6, roomWidth: 5, count: 1, spec: 'Paint' };
        return {
          key,
          input,
          direct: () => calcFinish(kind, input, {}),
        };
      }),
    ];

    cases.forEach(({ key, input, materials = {}, direct }) => {
      expect(ELEMENT_ENGINES[key].calc(input, materials)).toEqual(direct());
    });
  });
});
