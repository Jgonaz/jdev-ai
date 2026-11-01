// Imágenes mínimas para las pruebas: solo llevan lo que leen la detección de
// tipo y las dimensiones (no hace falta que se puedan decodificar).

export function png(width = 3, height = 2, relleno = 0): Buffer {
  const b = Buffer.alloc(33 + relleno);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

export function gif(width = 4, height = 5): Buffer {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

// JPEG con un APP0 y un SOF0.
export function jpeg(width = 6, height = 7): Buffer {
  const b = Buffer.alloc(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  b.write('JFIF', 6, 'ascii');
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  b.writeUInt16BE(height, 25);
  b.writeUInt16BE(width, 27);
  return b;
}

export function webpExtended(width = 8, height = 9): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'ascii');
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

export function webpLossless(width = 10, height = 11): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBPVP8L', 8, 'ascii');
  b[20] = 0x2f;
  b.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return b;
}

export function webpLossy(width = 12, height = 13): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBPVP8 ', 8, 'ascii');
  b.set([0x9d, 0x01, 0x2a], 23);
  b.writeUInt16LE(width, 26);
  b.writeUInt16LE(height, 28);
  return b;
}

export const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>\n';
