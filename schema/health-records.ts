import { z } from 'zod';
import { quantityUnits, categoryIdentifiers, assessmentIdentifiers, audiogramIdentifier, stateOfMindIdentifier, visionPrescriptionIdentifier, extendedIdentifiers } from './health-catalog.ts';
const timestamp = z.iso.datetime({ offset: true });
const source = z.strictObject({
  bundleIdentifier: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  version: z.string().max(128).nullable(),
  productType: z.string().max(128).nullable(),
  operatingSystemVersion: z.string().max(128).nullable(),
});
const common = {
  schemaVersion: z.literal(1),
  sourceRecordId: z.uuid(),
  collectedAt: timestamp,
};
const sampleFields = {
    startAt: timestamp,
    endAt: timestamp,
    hasUndeterminedDuration: z.boolean().optional(),
    source,
    device: z.strictObject({
      name: z.string().max(1024).nullable(),
      manufacturer: z.string().max(1024).nullable(),
      model: z.string().max(1024).nullable(),
      hardwareVersion: z.string().max(1024).nullable(),
      firmwareVersion: z.string().max(1024).nullable(),
      softwareVersion: z.string().max(1024).nullable(),
      localIdentifier: z.string().max(1024).nullable(),
      udiDeviceIdentifier: z.string().max(1024).nullable(),
    }).nullable(),
    sourceTimeZone: z.string().min(1).max(128).nullable(),
    metadata: z.record(z.string().min(1).max(256), z.json()),
};
const quantityDetailFields = { count: z.number().int().nonnegative(), aggregationStyle: z.number().int().nonnegative(), series: z.literal('notQueried') };
const quantityDetails = z.discriminatedUnion('kind', [
  z.strictObject({ ...quantityDetailFields, kind: z.literal('cumulative'), sum: z.number().finite() }),
  z.strictObject({ ...quantityDetailFields, kind: z.literal('discrete'), minimum: z.number().finite(), average: z.number().finite(),
    maximum: z.number().finite(), mostRecent: z.number().finite(), mostRecentStartAt: timestamp, mostRecentEndAt: timestamp }),
  z.strictObject({ ...quantityDetailFields, kind: z.literal('unspecified') }),
]).optional();
const deletionMetadata = { metadata: z.record(z.string().min(1).max(256), z.json()).nullable().optional() };
const stepCount = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, ...sampleFields, kind: z.literal('health.stepCount'), operation: z.literal('upsert'),
    quantity: z.number().nonnegative().finite(), unit: z.literal('count'), quantityDetails }),
  z.strictObject({ ...common, ...deletionMetadata, kind: z.literal('health.stepCount'), operation: z.literal('delete') }),
]);
function quantityType<const T extends string, const U extends string>(typeIdentifier: T, unit: U) {
  return z.strictObject({ ...common, ...sampleFields, kind: z.literal('health.quantity'), operation: z.literal('upsert'),
    typeIdentifier: z.literal(typeIdentifier), quantity: z.number().finite(), unit: z.literal(unit), quantityDetails });
}
const quantityIDs = z.enum(Object.keys(quantityUnits));
const [firstQuantity, ...otherQuantities] = Object.entries(quantityUnits);
if (!firstQuantity) throw new Error('Empty generated quantity catalog');
const quantities = z.discriminatedUnion('typeIdentifier', [quantityType(firstQuantity[0], firstQuantity[1]),
  ...otherQuantities.map(([identifier, unit]) => quantityType(identifier, unit))]);
const sleep = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, ...sampleFields, kind: z.literal('health.category'), operation: z.literal('upsert'),
    typeIdentifier: z.enum(categoryIdentifiers), value: z.number().int().nonnegative() }),
  z.strictObject({ ...common, ...deletionMetadata, kind: z.literal('health.category'), operation: z.literal('delete'),
    typeIdentifier: z.enum(categoryIdentifiers) }),
]);
function assessmentType<const T extends string>(typeIdentifier: T, answerCount: number, maximumRisk: number) {
  const identity = { ...common, kind: z.literal('health.scoredAssessment'), typeIdentifier: z.literal(typeIdentifier) };
  const assessment = z.strictObject({
    answers: z.array(z.number().int().min(0).max(4)).length(answerCount)
      .refine(answers => answers.every((answer, index) => answer <= 3 || (answerCount === 9 && index === 8)), 'Invalid assessment response'),
    score: z.number().int().min(0).max(answerCount * 3),
    riskRaw: z.number().int().min(1).max(maximumRisk),
  });
  return z.discriminatedUnion('operation', [
    z.strictObject({ ...identity, ...sampleFields, operation: z.literal('upsert'), assessment }),
    z.strictObject({ ...identity, ...deletionMetadata, operation: z.literal('delete') }),
  ]);
}
const scoredAssessments = z.discriminatedUnion('typeIdentifier', [
  assessmentType(assessmentIdentifiers.gad7, 7, 4), assessmentType(assessmentIdentifiers.phq9, 9, 5),
]);
const clampingRange = z.strictObject({ lowerBound: z.number().finite().nullable(), upperBound: z.number().finite().nullable() })
  .refine(v => (v.lowerBound !== null || v.upperBound !== null) &&
    (v.lowerBound === null || v.upperBound === null || v.lowerBound < v.upperBound), 'Invalid clamping bounds');
const sensitivityTest = z.strictObject({ sensitivity: z.number().finite(), conductionTypeRaw: z.literal(0),
  masked: z.boolean(), sideRaw: z.number().int().min(0).max(1), clampingRange: clampingRange.nullable() });
const audiogram = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, ...sampleFields, kind: z.literal('health.audiogram'), operation: z.literal('upsert'),
    typeIdentifier: z.literal(audiogramIdentifier), audiogram: z.strictObject({ frequencyUnit: z.literal('Hz'), sensitivityUnit: z.literal('dBHL'),
      points: z.array(z.strictObject({ frequency: z.number().finite().positive(), tests: z.array(sensitivityTest).max(128) })).max(30)
        .refine(points => points.reduce((sum, point) => sum + point.tests.length, 0) <= 128 &&
          points.every((point, index) => {
            const previous = points[index - 1];
            return index === 0 || (previous !== undefined && previous.frequency < point.frequency);
          }), 'Invalid audiogram points'),
    }) }),
  z.strictObject({ ...common, ...deletionMetadata, kind: z.literal('health.audiogram'), operation: z.literal('delete'), typeIdentifier: z.literal(audiogramIdentifier) }),
]);
const lensFields = { powerUnit: z.literal('D'), angleUnit: z.literal('deg'), lengthUnit: z.literal('mm'),
  sphere: z.number().finite(), cylinder: z.number().finite().nullable(), axis: z.number().finite().nullable(), addPower: z.number().finite().nullable() };
const visionPrism = z.strictObject({ unit: z.literal('pD'), angleUnit: z.literal('deg'), amount: z.number().finite(), angle: z.number().finite(),
  verticalAmount: z.number().finite(), horizontalAmount: z.number().finite(), verticalBaseRaw: z.number().int().min(0).max(4),
  horizontalBaseRaw: z.number().int().min(0).max(4), eyeRaw: z.number().int().min(1).max(2) });
const glassesLens = z.strictObject({ ...lensFields, vertexDistance: z.number().finite().nullable(), prism: visionPrism.nullable(),
  farPupillaryDistance: z.number().finite().nullable(), nearPupillaryDistance: z.number().finite().nullable() });
const contactsLens = z.strictObject({ ...lensFields, baseCurve: z.number().finite().nullable(), diameter: z.number().finite().nullable() });
const basePrescription = z.strictObject({ kind: z.literal('base') });
const prescriptionDates = { dateIssued: timestamp, expirationDate: timestamp.nullable() };
const visionValue = z.discriminatedUnion('typeRaw', [
  z.strictObject({ ...prescriptionDates, typeRaw: z.literal(1), details: z.discriminatedUnion('kind', [basePrescription,
    z.strictObject({ kind: z.literal('glasses'), leftEye: glassesLens.nullable(), rightEye: glassesLens.nullable() })]) }),
  z.strictObject({ ...prescriptionDates, typeRaw: z.literal(2), details: z.discriminatedUnion('kind', [basePrescription,
    z.strictObject({ kind: z.literal('contacts'), brand: z.string().max(4096), leftEye: contactsLens.nullable(), rightEye: contactsLens.nullable() })]) }),
]);
const visionPrescription = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, ...sampleFields, kind: z.literal('health.visionPrescription'), operation: z.literal('upsert'),
    typeIdentifier: z.literal(visionPrescriptionIdentifier), visionPrescription: visionValue }),
  z.strictObject({ ...common, ...deletionMetadata, kind: z.literal('health.visionPrescription'), operation: z.literal('delete'), typeIdentifier: z.literal(visionPrescriptionIdentifier) }),
]);
const stateOfMind = z.discriminatedUnion('operation', [
  z.strictObject({ ...common, ...sampleFields, kind: z.literal('health.stateOfMind'), operation: z.literal('upsert'),
    typeIdentifier: z.literal(stateOfMindIdentifier), stateOfMind: z.strictObject({
      kindRaw: z.number().int().min(1).max(2), valence: z.number().finite().min(-1).max(1), valenceClassificationRaw: z.number().int().min(1).max(7),
      labelsRaw: z.array(z.number().int().min(1).max(38)).max(128), associationsRaw: z.array(z.number().int().min(1).max(18)).max(128),
    }) }),
  z.strictObject({ ...common, ...deletionMetadata, kind: z.literal('health.stateOfMind'), operation: z.literal('delete'), typeIdentifier: z.literal(stateOfMindIdentifier) }),
]);
const seriesPoint = z.strictObject({ startAt: timestamp, endAt: timestamp, quantity: z.number().finite(),
  startReferenceTime: z.number().finite(), endReferenceTime: z.number().finite() })
  .refine(v => Date.parse(v.endAt) >= Date.parse(v.startAt) && v.endReferenceTime >= v.startReferenceTime, 'Invalid quantity interval');
function seriesType(identifier: string, unit: string) {
  const fields = { ...common, kind: z.literal('health.quantitySeries'), operation: z.literal('observe'),
    typeIdentifier: z.literal(identifier), unit: z.literal(unit) };
  return z.discriminatedUnion('stage', [
    z.strictObject({ ...fields, stage: z.literal('points'), startIndex: z.number().int().nonnegative(), points: z.array(seriesPoint).min(1).max(128) })
      .refine(v => identifier !== 'HKQuantityTypeIdentifierStepCount' || v.points.every(p => p.quantity >= 0), 'Negative step quantity'),
    z.strictObject({ ...fields, stage: z.literal('end'), pointCount: z.number().int().nonnegative(), chunkCount: z.number().int().nonnegative(),
      orderedChunksHash: z.string().regex(/^[a-f0-9]{64}$/), expectedCount: z.number().int().nonnegative(), result: z.enum(['returnedEmpty', 'exhausted']) })
      .refine(v => v.chunkCount === Math.ceil(v.pointCount / 128) && (v.pointCount === 0) === (v.result === 'returnedEmpty'), 'Invalid series completion'),
  ]);
}
const quantitySeries = z.discriminatedUnion('typeIdentifier', [seriesType('HKQuantityTypeIdentifierStepCount', 'count'),
  ...Object.entries(quantityUnits).map(([identifier, unit]) => seriesType(identifier, unit))]);
const coordinates = { latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  horizontalAccuracyM: z.number().finite().nonnegative(), accuracyAuthorization: z.enum(['full', 'reduced', 'unknown']) };
const observation = { schemaVersion: z.literal(1), operation: z.literal('observe'), collectedAt: timestamp };
const point = z.strictObject({ ...observation, kind: z.literal('location.point'), sourceAPI: z.literal('CoreLocation.CLLocation'),
  observation: z.strictObject({ ...coordinates, observedAt: timestamp, altitudeM: z.number().finite().nullable(),
    verticalAccuracyM: z.number().finite().nonnegative().nullable(), speedMPS: z.number().finite().nonnegative().nullable(),
    speedAccuracyMPS: z.number().finite().nonnegative().nullable(), courseDegrees: z.number().finite().min(0).max(360).nullable(),
    courseAccuracyDegrees: z.number().finite().nonnegative().nullable(), isSimulatedBySoftware: z.boolean().nullable(),
    isProducedByAccessory: z.boolean().nullable() }) });
const visit = z.strictObject({ ...observation, kind: z.literal('location.visit'), sourceAPI: z.literal('CoreLocation.CLVisit'),
  observation: z.strictObject({ ...coordinates, arrivalAt: timestamp.nullable(), departureAt: timestamp.nullable() })
    .refine(v => v.arrivalAt === null || v.departureAt === null || Date.parse(v.departureAt) >= Date.parse(v.arrivalAt), 'Invalid visit interval') });
const activity = z.strictObject({ ...observation, kind: z.literal('motion.activity'), sourceAPI: z.literal('CoreMotion.CMMotionActivity'),
  observation: z.strictObject({ startAt: timestamp, endAt: z.null(), confidenceRaw: z.number().int().nonnegative(),
    stationary: z.boolean(), walking: z.boolean(), running: z.boolean(), automotive: z.boolean(), cycling: z.boolean(), unknown: z.boolean() }) });
function isForwardInterval({ startAt, endAt }: { startAt: string; endAt: string }): boolean {
  const fraction = /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/;
  const start = Date.parse(startAt.replace(fraction, '')), end = Date.parse(endAt.replace(fraction, ''));
  const a = startAt.match(fraction)?.[1] ?? '', b = endAt.match(fraction)?.[1] ?? '', length = Math.max(a.length, b.length);
  return end > start || (end === start && b.padEnd(length, '0') > a.padEnd(length, '0'));
}
const motionHistoryGap = z.strictObject({ ...observation, kind: z.literal('motion.historyGap'), sourceAPI: z.literal('CoreMotion.CMMotionActivityManager'),
  observation: z.strictObject({ startAt: timestamp, endAt: timestamp, reason: z.literal('outsideAPIHistoryWindow'), historyWindowDays: z.literal(7) }) })
  .refine(v => isForwardInterval(v.observation), 'Invalid unavailable interval');
const extendedPoint = z.union([
  z.strictObject({ timeSinceStartSeconds: z.number().finite().nonnegative(), leadRaw: z.literal(1), volts: z.number().finite().nullable() }),
  z.strictObject({ timeSinceStartSeconds: z.number().finite().nonnegative(), precededByGap: z.boolean() }),
  z.strictObject({ timestamp, referenceTime: z.number().finite(), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
    altitudeM: z.number().finite(), horizontalAccuracyM: z.number().finite(), verticalAccuracyM: z.number().finite(),
    speedMPS: z.number().finite(), speedAccuracyMPS: z.number().finite(), courseDegrees: z.number().finite(), courseAccuracyDegrees: z.number().finite(),
    ellipsoidalAltitudeM: z.number().finite(), floorLevel: z.number().int().nullable(), isSimulatedBySoftware: z.boolean().nullable(), isProducedByAccessory: z.boolean().nullable() }),
]);
const extended = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal('health.extended'),
  typeIdentifier: z.enum(Object.keys(extendedIdentifiers)), family: z.enum(['characteristic', 'correlation', 'activitySummary', 'electrocardiogram', 'heartbeatSeries', 'medicationConcept', 'medicationDoseEvent', 'route', 'workout']),
  sourceRecordId: z.string().min(1).max(256), collectedAt: timestamp, index: z.number().int().nonnegative(),
  operation: z.enum(['upsert', 'observe', 'delete']), stage: z.enum(['parent', 'snapshot', 'member', 'detail', 'points', 'archive', 'end', 'delete']),
  memberTypeIdentifiers: z.array(z.string().regex(/^HK(?:Quantity|Category)TypeIdentifier\w+$/)).max(128).nullable().optional(), payload: z.record(z.string(), z.json()),
}).superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message });
  const expectedFamily = Object.entries(extendedIdentifiers).find(([id]) => id === value.typeIdentifier)?.[1];
  if (value.family !== expectedFamily) fail('Type/family mismatch');
  const snapshot = ['characteristic', 'activitySummary', 'medicationConcept'].includes(value.family);
  if ((value.stage === 'snapshot' && !snapshot) || (['parent', 'delete'].includes(value.stage) && snapshot)) fail('Invalid snapshot stage');
  const operation = value.stage === 'parent' ? 'upsert' : value.stage === 'delete' ? 'delete' : 'observe';
  if (operation !== value.operation) fail('Invalid stage operation');
  if ((value.family === 'correlation') !== (value.memberTypeIdentifiers !== undefined)) fail('Unbound correlation dependencies');
  if (value.memberTypeIdentifiers === null && value.stage !== 'delete') fail('Unknown dependencies only allowed for deletion');
  if (Buffer.byteLength(JSON.stringify(value.payload)) > 48 * 1024) fail('Payload too large');
  if (value.stage === 'member' && value.family !== 'correlation') fail('Invalid member family');
  if (value.stage === 'detail' && value.family !== 'workout') fail('Invalid workout detail');
  if (value.stage === 'archive') {
    const parsed = z.strictObject({ format: z.literal('NSSecureCoding'), base64: z.string().min(1).max(32768).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).safeParse(value.payload);
    if (!parsed.success || Buffer.from(parsed.data.base64, 'base64').length > 24 * 1024) fail('Invalid archive chunk');
  }
  if (value.stage === 'points') {
    const parsed = z.strictObject({ points: z.array(extendedPoint).min(1).max(128) }).safeParse(value.payload);
    if (!['electrocardiogram', 'heartbeatSeries', 'route'].includes(value.family) || !parsed.success) fail('Invalid points');
    else if (!parsed.data.points.every(point => value.family === 'route' ? 'latitude' in point : value.family === 'electrocardiogram' ? 'volts' in point : 'precededByGap' in point)) fail('Wrong point family');
  }
  if (value.stage === 'end') {
    const parsed = z.strictObject({ pointCount: z.number().int().nonnegative(), chunkCount: z.number().int().nonnegative(), archiveChunkCount: z.number().int().nonnegative(),
      orderedChunksHash: z.string().regex(/^[a-f0-9]{64}$/), result: z.enum(['returnedEmpty', 'exhausted']) }).safeParse(value.payload);
    if (!parsed.success) fail('Invalid completion');
    else if ((parsed.data.pointCount === 0) !== (parsed.data.result === 'returnedEmpty')) fail('Inconsistent completion result');
  }
  if (value.stage === 'parent' && typeof value.payload.startAt === 'string' && typeof value.payload.endAt === 'string' &&
      (!timestamp.safeParse(value.payload.startAt).success || !timestamp.safeParse(value.payload.endAt).success || Date.parse(value.payload.endAt) < Date.parse(value.payload.startAt))) fail('Invalid sample interval');
});

export const RecordContentSchema = z.union([extended, stepCount, quantities, sleep, scoredAssessments, audiogram, stateOfMind, visionPrescription, quantitySeries, point, visit, activity, motionHistoryGap,
  z.strictObject({ ...common, ...deletionMetadata, kind: z.literal('health.quantity'), operation: z.literal('delete'), typeIdentifier: quantityIDs }),
]);
