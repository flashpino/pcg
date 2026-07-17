// Offset por sensor: soma-se à leitura crua na ingestão pra compensar erro sistemático do
// sensor físico. A conta é sempre relativa ao offset atual, então recalibrar um sensor que
// já tem offset aplicado continua correto (não duplica nem zera a correção anterior).
export function calcOffset(currentOffset: number, reference: number, latestTemp: number): number {
  return currentOffset + (reference - latestTemp);
}
