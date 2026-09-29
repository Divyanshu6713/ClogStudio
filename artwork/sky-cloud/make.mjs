// Original artwork (no licensed characters): line-art cloud band + round sky badge.
import { writeFileSync } from 'node:fs';

const cloud = (x, y, s, stroke, w, fill = 'none') =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M-62 22 H62 A22 22 0 0 0 58 -12 A26 26 0 0 0 16 -30 A34 34 0 0 0 -42 -16 A22 22 0 0 0 -62 22 Z" fill="${fill}" stroke="${stroke}" stroke-width="${w / s}" stroke-linejoin="round"/>`;

// 1) Sole band: 2000×280, transparent, clouds in sky-blue outline.
const band = [];
const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })();
for (let x = 90, i = 0; x < 1950; i++) {
  const s = 0.55 + rnd() * 0.55;
  const y = 150 + (i % 2 ? -38 : 34) + (rnd() - 0.5) * 20;
  band.push(cloud(x, y, s, '#2FA9DD', 7));
  x += 120 * s + 60 + rnd() * 40;
}
// small swirl lines between clouds
for (let x = 180; x < 1900; x += 330)
  band.push(`<path d="M${x} 232 q18 -14 36 0 t36 0" fill="none" stroke="#7FCBEA" stroke-width="5" stroke-linecap="round"/>`);
writeFileSync('cloud-band.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="280" viewBox="0 0 2000 280">${band.join('')}</svg>`);

// 2) Round badge: red ring, white face, blue sky with a cloud and a yellow sun.
writeFileSync('sky-badge.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <circle cx="300" cy="300" r="290" fill="#C8202A"/>
  <circle cx="300" cy="300" r="245" fill="#FFFFFF"/>
  <clipPath id="c"><circle cx="300" cy="300" r="225"/></clipPath>
  <g clip-path="url(#c)">
    <rect x="0" y="0" width="600" height="600" fill="#02A3D6"/>
    <circle cx="395" cy="215" r="62" fill="#F2C318"/>
    ${cloud(270, 330, 2.1, '#FFFFFF', 0, '#FFFFFF')}
    ${cloud(420, 430, 1.2, '#FFFFFF', 0, '#FFFFFF')}
  </g>
  <circle cx="300" cy="300" r="225" fill="none" stroke="#FFFFFF" stroke-width="10"/>
</svg>`);
console.log('ok');
