/**
 * Identify IfcBeam swept profiles as one of the constant-section Beams
 * variants that overlap Columns: Rectangular, L, T.
 *
 * L/T/rectangle detection is the Columns classifier (ifcColumnProfile) —
 * T and L are the same orthogonal polygons whether the extrusion is a
 * column shaft or a beam span. Circular and Cruciform are not Beams
 * shapes and are rejected here.
 *
 * Cantilever-tapered and Ground-tie are not section-class problems:
 * taper is two profiles along the span; ground-tie is a rectangular
 * section with an earth-supported soffit (label, not geometry).
 */
import {
  classifyColumnProfile,
  type ColumnProfileClassification,
} from './ifcColumnProfile';
import type { IfcRawProfile } from './ifcImport';

export type BeamSectionSource =
  | 'NATIVE_RECTANGLE'
  | 'ARBITRARY_RECTANGLE'
  | 'NATIVE_LSHAPE'
  | 'ARBITRARY_LSHAPE'
  | 'NATIVE_TSHAPE'
  | 'ARBITRARY_TSHAPE';

export type BeamSectionClassification =
  | {
      ok: true;
      shape: 'RECTANGULAR';
      width: number;
      depth: number;
      source: 'NATIVE_RECTANGLE' | 'ARBITRARY_RECTANGLE';
    }
  | {
      ok: true;
      shape: 'L_SECTION';
      flangeWidth: number;
      overallDepth: number;
      flangeThickness: number;
      webWidth: number;
      source: 'NATIVE_LSHAPE' | 'ARBITRARY_LSHAPE';
    }
  | {
      ok: true;
      shape: 'T_SECTION';
      flangeWidth: number;
      overallDepth: number;
      flangeThickness: number;
      webWidth: number;
      source: 'NATIVE_TSHAPE' | 'ARBITRARY_TSHAPE';
    }
  | { ok: false; reason: string };

export type ClassifiedBeamSection = Extract<
  BeamSectionClassification,
  { ok: true }
>;

function remapColumnSection(
  classified: Extract<ColumnProfileClassification, { ok: true }>,
): BeamSectionClassification {
  if (classified.shape === 'RECTANGULAR') {
    return {
      ok: true,
      shape: 'RECTANGULAR',
      width: classified.width,
      depth: classified.depth,
      source: classified.source,
    };
  }
  if (classified.shape === 'L_SHAPED') {
    return {
      ok: true,
      shape: 'L_SECTION',
      flangeWidth: classified.width,
      overallDepth: classified.depth,
      flangeThickness: classified.legThickness,
      webWidth: classified.legThickness,
      source: classified.source,
    };
  }
  if (classified.shape === 'T_SHAPED') {
    return {
      ok: true,
      shape: 'T_SECTION',
      flangeWidth: classified.flangeWidth,
      overallDepth: classified.overallDepth,
      flangeThickness: classified.flangeThickness,
      webWidth: classified.webThickness,
      source: classified.source,
    };
  }
  if (classified.shape === 'CIRCULAR') {
    return {
      ok: false,
      reason:
        'Circular column sections are not a Beams variant — review manually',
    };
  }
  return {
    ok: false,
    reason:
      'Cruciform column sections are not a Beams variant — review manually',
  };
}

/**
 * Classify a beam swept profile into Rectangular / L / T.
 * Ambiguous sections return ok: false — callers must not guess.
 */
export function classifyBeamSectionProfile(
  profile: IfcRawProfile | null | undefined,
): BeamSectionClassification {
  const classified = classifyColumnProfile(profile);
  if (!classified.ok) {
    return {
      ok: false,
      reason: classified.reason.replace(
        'column section',
        'beam section',
      ),
    };
  }
  return remapColumnSection(classified);
}
