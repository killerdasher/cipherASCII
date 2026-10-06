/**
 * Create a simple app icon using canvas
 */

const { createCanvas } = require('canvas');
const { writeFileSync, mkdirSync, existsSync } = require('fs');

function createIcon(size, outputPath) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#1a1612');
  gradient.addColorStop(1, '#0c0c10');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Border
  ctx.strokeStyle = '#d4a53c';
  ctx.lineWidth = size * 0.04;
  ctx.strokeRect(size * 0.05, size * 0.05, size * 0.9, size * 0.9);

  // ASCII text
  ctx.font = `bold ${size * 0.35}px "Cascadia Mono", monospace`;
  ctx.fillStyle = '#d4a53c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ASCII', size / 2, size * 0.35);

  ctx.font = `bold ${size * 0.25}px "Cascadia Mono", monospace`;
  ctx.fillStyle = '#f5f0e8';
  ctx.fillText('ART', size / 2, size * 0.6);
  ctx.fillText('STUDIO', size / 2, size * 0.8);

  // Decorative corners
  ctx.strokeStyle = '#d4a53c80';
  ctx.lineWidth = 2;
  const cornerSize = size * 0.12;
  // Top-left
  ctx.beginPath();
  ctx.moveTo(size * 0.1, size * 0.1 + cornerSize);
  ctx.lineTo(size * 0.1, size * 0.1);
  ctx.lineTo(size * 0.1 + cornerSize, size * 0.1);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(size * 0.9 - cornerSize, size * 0.1);
  ctx.lineTo(size * 0.9, size * 0.1);
  ctx.lineTo(size * 0.9, size * 0.1 + cornerSize);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(size * 0.1, size * 0.9 - cornerSize);
  ctx.lineTo(size * 0.1, size * 0.9);
  ctx.lineTo(size * 0.1 + cornerSize, size * 0.9);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(size * 0.9 - cornerSize, size * 0.9);
  ctx.lineTo(size * 0.9, size * 0.9);
  ctx.lineTo(size * 0.9, size * 0.9 - cornerSize);
  ctx.stroke();

  const buffer = canvas.toBuffer('image/png');
  const dir = require('path').dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(outputPath, buffer);
  console.log(`Created ${outputPath} (${size}x${size})`);
}

// Create multiple sizes
const sizes = [16, 32, 48, 64, 128, 256, 512];
for (const size of sizes) {
  createIcon(size, `public/icon-${size}.png`);
}

// Create main icon.png (256x256)
createIcon(256, 'public/icon.png');

console.log('Icons created. electron-builder will generate .ico/.icns automatically.');