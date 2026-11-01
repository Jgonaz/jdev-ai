import { describe, expect, it } from 'vitest';
import { isValidProfileName } from '../../shared/settings-schema.ts';
import { integerError, profileNameInput } from './validation.ts';

describe('integerError', () => {
  it('acepta enteros dentro del rango, extremos incluidos', () => {
    expect(integerError('100', 100, 100000)).toBeNull();
    expect(integerError('100000', 100, 100000)).toBeNull();
    expect(integerError('5000', 100, 100000)).toBeNull();
  });

  it('rechaza vacíos, decimales, negativos y valores fuera de rango con el rango en el mensaje', () => {
    for (const malo of ['', 'abc', '12,5', '-5', '99', '100001', '1e3']) {
      expect(integerError(malo, 100, 100000)).toBe('Escribe un número entero entre 100 y 100000.');
    }
  });
});

describe('profileNameInput', () => {
  it('cambia tabuladores y otros caracteres de control por un espacio y colapsa los repetidos', () => {
    expect(profileNameInput('Ana\tMaría').text).toBe('Ana María');
    expect(profileNameInput('Ana \t\n María').text).toBe('Ana María');
    expect(profileNameInput('Jor\u0000ge x').text).toBe('Jor ge x');
    // Mientras se escribe se conserva el espacio final; lo guardado va sin él.
    expect(profileNameInput('Ana ')).toEqual({ text: 'Ana ', value: 'Ana', error: null });
    expect(profileNameInput('\tAna\n').value).toBe('Ana');
  });

  it('cuenta el límite por puntos de código, como el servidor', () => {
    expect(profileNameInput('😀'.repeat(60)).error).toBeNull();
    expect(profileNameInput('ñ'.repeat(60)).error).toBeNull();
    const largo = profileNameInput('😀'.repeat(61));
    expect(largo.error).toBe('Como mucho 60 caracteres: acórtalo para guardarlo.');
    expect(largo.text).toBe('😀'.repeat(61));
    // Los espacios de los extremos no cuentan.
    expect(profileNameInput(` ${'a'.repeat(60)} `).error).toBeNull();
  });

  it('lo que el cliente da por válido lo acepta el servidor', () => {
    for (const raw of ['Ana\tMaría', 'x\u0000y', 'a b', '  Jorge  ', '😀'.repeat(60), 'a'.repeat(61), '']) {
      const r = profileNameInput(raw);
      expect(isValidProfileName(r.value)).toBe(r.error === null);
    }
  });
});
