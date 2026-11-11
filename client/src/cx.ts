export type ClassValue = string | false | null | undefined;

export function cx(...classes: ClassValue[]): string {
  return classes.filter((c): c is string => Boolean(c)).join(' ');
}
