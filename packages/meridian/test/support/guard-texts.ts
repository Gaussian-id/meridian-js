// Env file texts for the contract guard, ported from meridian-python tests/test_contract_guard.py (TEXTS, HIDING,
// PRINTABLE, REVIEW_FIXTURES, ROUND_3, differential_texts). Every value is fake.

export const GEMINI = 'GAUSSMERIDIAN_GEMINI_API_KEY'
export const OPENROUTER = 'GAUSSMERIDIAN_OPENROUTER_API_KEY'

/** What a text that cannot be checked reports. */
export const BOTH = [GEMINI, OPENROUTER]

const KELVIN = 'K'
const LONG_S = 'ſ'
const DOTTED = 'İ'
const DOTLESS = 'ı'
const TATWEEL = 'ـ'
const ETNAHTA = '֑'
const E_ACUTE = 'é'

// Env file texts and the names the guard must report. A paid name counts as set unless its line is exactly an empty
// assignment; a character that some reader skips, folds away or breaks a line at means neither name can be checked.
export const TEXTS: [string, string[]][] = [
  ['GAUSSMERIDIAN_GEMINI_API_KEY=abc', [GEMINI]],
  ['export GAUSSMERIDIAN_OPENROUTER_API_KEY="x"\r\n', [OPENROUTER]],
  ['gaussmeridian_gemini_api_key = y', [GEMINI]],
  ['set GAUSSMERIDIAN_GEMINI_API_KEY=abc\r\n', [GEMINI]],
  ['SET GAUSSMERIDIAN_OPENROUTER_API_KEY=abc', [OPENROUTER]],
  ['set "GAUSSMERIDIAN_GEMINI_API_KEY=abc"', [GEMINI]],
  ['   export    GAUSSMERIDIAN_GEMINI_API_KEY   =   "abc"   ', [GEMINI]],
  ["GAUSSMERIDIAN_GEMINI_API_KEY='abc'", [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY: abc', [GEMINI]],
  ['﻿GAUSSMERIDIAN_GEMINI_API_KEY=abc', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=abc # trailing comment', [GEMINI]],

  // a quoted value that runs over several lines is a value
  ['GAUSSMERIDIAN_GEMINI_API_KEY="line one\nline two"\nB=2', [GEMINI]],
  ["GAUSSMERIDIAN_OPENROUTER_API_KEY='a\r\nb\r\n'", [OPENROUTER]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY="', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY="a\\"b"', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=" "', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=#abc', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=   # looks empty', [GEMINI]],

  // any line that sets it counts, even if a later one empties it
  ['GAUSSMERIDIAN_GEMINI_API_KEY=abc\nGAUSSMERIDIAN_GEMINI_API_KEY=\n', [GEMINI]],
  [`${OPENROUTER}=a\n${GEMINI}=b\n${OPENROUTER}=c`, [OPENROUTER, GEMINI]],

  // a quoted value is followed by a new statement on the same line (compose)
  ['GAUSSMERIDIAN_GEMINI_API_KEY=""GAUSSMERIDIAN_GEMINI_API_KEY=VAL', [GEMINI]],
  ['A="" GAUSSMERIDIAN_OPENROUTER_API_KEY=VAL', [OPENROUTER]],
  ["A='' GAUSSMERIDIAN_OPENROUTER_API_KEY=VAL", [OPENROUTER]],
  ['A="x\nline" GAUSSMERIDIAN_OPENROUTER_API_KEY=VAL', [OPENROUTER]],
  ['A="x" GAUSSMERIDIAN_OPENROUTER_API_KEY=VAL', [OPENROUTER]],
  ['A="a\\" GAUSSMERIDIAN_OPENROUTER_API_KEY=VAL', [OPENROUTER]],
  ['A="x\nGAUSSMERIDIAN_OPENROUTER_API_KEY=VAL\n"', [OPENROUTER]],

  // a line that starts with `#` but holds a quote may close a quoted value; compose then reads what follows
  ['A="x\n#"GAUSSMERIDIAN_GEMINI_API_KEY=VAL', [GEMINI]],
  ['A="x\n# a" GAUSSMERIDIAN_GEMINI_API_KEY=VAL', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=${UNSET:-VAL}', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=$X', [GEMINI]],

  // a whitespace-only value is set for both local-up readers
  ['GAUSSMERIDIAN_GEMINI_API_KEY= ', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\t', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=   \r\n', [GEMINI]],

  // both local-up readers strip only double quotes, so two single quotes are a two-character value
  ["GAUSSMERIDIAN_GEMINI_API_KEY=''", [GEMINI]],
  ["export GAUSSMERIDIAN_GEMINI_API_KEY=''", [GEMINI]],
  ["GAUSSMERIDIAN_GEMINI_API_KEY\t:''", [GEMINI]],
  [`${GEMINI}=\n${OPENROUTER}=''\n`, [OPENROUTER]],

  // anything but exactly an empty assignment counts, wherever the name is on the line
  ["GAUSSMERIDIAN_GEMINI_API_KEY=''  # empty", [GEMINI]],
  ['set "GAUSSMERIDIAN_GEMINI_API_KEY="', [GEMINI]],
  ['export GAUSSMERIDIAN_GEMINI_API_KEY', [GEMINI]], // compose takes the value from its own environment
  ['GAUSSMERIDIAN_GEMINI_API_KEY', [GEMINI]],
  ['  GAUSSMERIDIAN_GEMINI_API_KEY=', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=""""', [GEMINI]],
  ['A="x" # GAUSSMERIDIAN_OPENROUTER_API_KEY=VAL', [OPENROUTER]],
  ['OTHER=1 # GAUSSMERIDIAN_GEMINI_API_KEY=abc', [GEMINI]],
  ['REM set GAUSSMERIDIAN_GEMINI_API_KEY=abc', [GEMINI]],
  ['XGAUSSMERIDIAN_GEMINI_API_KEY=abc', [GEMINI]],
  ['GAUSSMERIDIAN_GEMINI_API_KEY_OTHER=abc', [GEMINI]],

  // anything outside printable ASCII and tab, anywhere in the file: neither name can be checked. Some reader folds
  // it to a name's letter (Kelvin sign, long s, dotted capital I), skips it (marks, tatweel), or breaks a line at it.
  [`GAUSSMERIDIAN_GEMINI_API_${KELVIN}EY=VAL`, BOTH],
  [`GAUS${LONG_S}MERIDIAN_GEMINI_API_KEY=VAL`, BOTH],
  [`GAUSSMERIDIAN_GEMINI_API_${KELVIN}EY=`, BOTH],
  [`GAUSSMER${DOTTED}DIAN_GEMINI_API_KEY=VAL`, BOTH],
  [`GAUSS${TATWEEL}MERIDIAN_GEMINI_API_KEY=VAL`, BOTH],
  [`GAUSSMERIDIAN_GEMINI_API_KEY${ETNAHTA}=VAL`, BOTH],
  [`A=caf${E_ACUTE}\n`, BOTH],
  [`# ${E_ACUTE}\n`, BOTH],
  ['A=1\rGAUSSMERIDIAN_GEMINI_API_KEY=abc\rB=2', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=   \rVAL', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\rVAL', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\r"VAL"', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\r#VAL', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\rA=1', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY\r=VAL', BOTH],
  ['export\rGAUSSMERIDIAN_GEMINI_API_KEY=VAL', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\r\r\n', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY="\r"', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\x1c', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\x1c\n', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\x85', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\xa0', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY= ', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=​', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=﻿', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\vVAL', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\v\n', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\f', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API_KEY= \t\v\f\r \r\n', BOTH],
  ['GAUSSMERIDIAN_GEMINI_API\x01_KEY=VAL', BOTH],
  ['﻿﻿GAUSSMERIDIAN_GEMINI_API_KEY=', BOTH],
  ['A=1\n# a note\xa0\nB=2', BOTH],

  // not keys
  ['# GAUSSMERIDIAN_GEMINI_API_KEY=abc', []],
  ['   # export GAUSSMERIDIAN_GEMINI_API_KEY=abc', []],
  ['\t# GAUSSMERIDIAN_GEMINI_API_KEY=abc', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=""', []],
  ['gaussmeridian_gemini_api_key=', []],
  ['set GAUSSMERIDIAN_GEMINI_API_KEY=', []],
  ['export GAUSSMERIDIAN_GEMINI_API_KEY=', []],
  ['EXPORT\tGAUSSMERIDIAN_GEMINI_API_KEY=', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY =', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY\t=""', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY:', []],
  ['﻿GAUSSMERIDIAN_GEMINI_API_KEY=', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\r\n', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\r\nA=1', []],
  ['GAUSSMERIDIAN_GEMINI_API_KEY=\r\n\r\n', []],
  [`${GEMINI}=\n${OPENROUTER}=""\n`, []],
  ['A=""\nGAUSSMERIDIAN_GEMINI_API_KEY=""\n# GAUSSMERIDIAN_GEMINI_API_KEY=abc', []],
  ['A="x\n# GAUSSMERIDIAN_GEMINI_API_KEY=VAL\n"', []],
  ["A='x\n# GAUSSMERIDIAN_GEMINI_API_KEY=VAL\n'", []],
  ['A=1\tB=~ !"#$%&()*+,-./:;<>?@[\\]^_`{|}\n', []],
  ['GAUSSMERIDIAN_DB_PASSWORD=abc', []],
  ['', []]
]

const chars = (...points: number[]) => points.map(point => String.fromCodePoint(point))

export const HIDING = [
  ...chars(0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1c, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0xa0, 0xad, 0x34f, 0x61c, 0x115f, 0x1680),
  ...chars(0x17b4, 0x180b, 0x180e, 0x180f, 0x2000, 0x200a, 0x200b, 0x200f, 0x202a, 0x202e, 0x202f, 0x2028, 0x2029),
  ...chars(0x205f, 0x2060, 0x2064, 0x206f, 0x3000, 0x3164, 0xfe00, 0xfe0f, 0xfeff, 0xffa0, 0xfff0, 0xfff9, 0x1bca0),
  ...chars(0x1d173, 0xe0001, 0xe0020, 0xe0100, 0xe0fff),
  '\r',

  // what the culture-sensitive StartsWith of local-common.ps1 skips (ICU), or what folds to a name's letter
  ...chars(0x00, 0x300, 0x591, 0x640, 0x7fa, 0x180a, 0x1cd3, 0xfe73, 0x903, 0x20dd, 0x130, 0x131, 0x17f, 0x212a),
  ...chars(0xe9, 0x4e2d, 0x1f600)
]

export const PRINTABLE = '\t' + chars(...Array.from({ length: 0x7f - 0x20 }, (_, at) => 0x20 + at)).join('')

export const label = (char: string) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`

// The security reviewer's probes (fake values): every one is set for compose or for a local-up reader, except the
// dotless i, which no reader folds to I.
export const REVIEW_FIXTURES: Record<string, string> = {
  'a01-name-nbsp-eq': `${GEMINI}\xa0=FAKEA01\n`,
  'a02-name-nel-eq': `${GEMINI}\x85=FAKEA02\n`,
  'a03-export-nbsp': `export\xa0${GEMINI}=FAKEA03\n`,
  'a04-nbsp-emptyq-then-key': `A=\xa0""${GEMINI}=FAKEA04\n`,
  'a05-nel-emptysq-then-key': `A=\x85''${GEMINI}=FAKEA05\n`,
  'a06-name-nbsp-colon': `${GEMINI}\xa0:FAKEA06\n`,
  'a07-nbsp-q-then-key': `A=\xa0"x"${GEMINI}=FAKEA07\n`,
  'a08-export-nel': `export\x85${GEMINI}=FAKEA08\n`,
  'a09-space-nbsp-eq': `${GEMINI} \xa0 =FAKEA09\n`,
  'a10-self-nbsp-emptyq': `${GEMINI}=\xa0""${GEMINI}=FAKEA10\n`,
  'a11-lead-nbsp': `\xa0${GEMINI}=FAKEA11\n`,
  'a12-export-sp-nbsp': `export \xa0${GEMINI}=FAKEA12\n`,
  'a13-tab-emptyq-key': `A=\t""${GEMINI}=FAKEA13\n`,
  'a14-vt-emptyq-key': `A=\v""${GEMINI}=FAKEA14\n`,
  'a15-bs-quote': `A="\\\\"${GEMINI}=FAKEA15"\n`,
  'a16-crlf-emptyq-cr-key': `A=""\r${GEMINI}=FAKEA16\n`,
  'a17-sq-esc': `A='x\\'${GEMINI}=FAKEA17\n`,
  'a18-dq-multi-then': `A="l1\nl2"${GEMINI}=FAKEA18\n`,
  'a19-nbsp-before-colon-sp': `${GEMINI}\xa0 :FAKEA19\n`,
  'a20-inherit': `${GEMINI}\n`,
  'b01-kelvin': `GAUSSMERIDIAN_GEMINI_API_${KELVIN}EY=FAKEB01\n`,
  'b02-longs': `GAUS${LONG_S}MERIDIAN_GEMINI_API_KEY=FAKEB02\n`,
  'b03-dotless-i': `GAUSSMER${DOTLESS}DIAN_GEMINI_API_KEY=FAKEB03\n`,
  'b04-openrouter-nbsp': `${OPENROUTER}\xa0= FAKEB04\n`,
  'b05-nel-q-then': `A=\x85"y"${OPENROUTER}=FAKEB05\n`,
  'b06-tab-nbsp-eq': `${GEMINI}\t\xa0\t=FAKEB06\n`,
  'c01-or-space_g-nbsp': `GAUSSMERIDIAN_DB_USERNAME=fake\n${OPENROUTER}= \n${GEMINI}\xa0=FAKEC01\n`,
  'c02-or-vt_g-nbsp': `${OPENROUTER}=\v\n${GEMINI}\xa0=FAKEC02\n`,
  'c03-or-softhyphen-in-quote_g-nbsp': `A="\n${OPENROUTER}\xad=x\n"\n${GEMINI}\xa0=FAKEC03\n`,
  'c04-or-tab_g-nbsp-emptyq': `${OPENROUTER}=\t\nA=\xa0""${GEMINI}=FAKEC04\n`,
  '01-cr-after-eq': `${GEMINI}=\rFAKEVAL01\n`,
  '02-spaces-cr': `${GEMINI}=   \rFAKEVAL02\n`,
  '03-cr-quoted': `${GEMINI}=\r"FAKEVAL03"\n`,
  '04-same-line': `A="" ${GEMINI}=FAKEVAL04\n`,
  '05-same-line-self': `${GEMINI}=""${GEMINI}=FAKEVAL05\n`,
  '06-cr-before-eq': `${GEMINI}\r=FAKEVAL06\n`,
  '07-cr-hash': `${GEMINI}=\r#FAKEVAL07\n`,
  '08-after-multiline': `A="x\nline" ${OPENROUTER}=FAKEVAL08\n`,
  '09-export-cr': `export\r${GEMINI}=FAKEVAL09\n`,
  '10-nbsp-only': `${GEMINI}=\xa0\n`,
  '11-emspace-only': `${GEMINI}= \n`,
  '12-zwsp-only': `${GEMINI}=​\n`,
  '13-vt': `${GEMINI}=\vFAKEVAL13\n`,
  '14-vt-only': `${GEMINI}=\v\n`,
  '15-fs-only': `${GEMINI}=\x1c\n`,
  '16-nel-only': `${GEMINI}=\x85\n`,
  '17-ff-only': `${GEMINI}=\f\n`,
  '18-last-empty': `${GEMINI}=FAKEVAL18\n${GEMINI}=\n`,
  '19-first-empty': `${GEMINI}=\n${GEMINI}=FAKEVAL19\n`,
  '20-lower': `${GEMINI.toLowerCase()}=FAKEVAL20\n`,
  '21-u2028': `${GEMINI}= FAKEVAL21\n`,
  '22-fs-val': `${GEMINI}=\x1cFAKEVAL22\n`,
  '23-quoted-cr': `${GEMINI}="\r"\n`,
  '24-bom-in-value': `${GEMINI}=﻿FAKEVAL24\n`,
  '25-bom': `﻿${GEMINI}=FAKEVAL25\n`,
  '26-interp': `${GEMINI}=\${UNSET_THING:-FAKEVAL26}\n`,
  '27-ref': `X=FAKEVAL27\n${GEMINI}=$X\n`
}

// The third round (fake values): two single quotes are a value for both local-up readers; Windows compose matches a
// dotted capital I to I; the culture-sensitive StartsWith skips marks and a few letters (U+0640, U+07FA, U+FE73) and
// punctuation (U+180A, U+1CD3)
const SQ = "''"
const DB = 'GAUSSMERIDIAN_DB_USERNAME=fakeuser\nGAUSSMERIDIAN_DB_PASSWORD=fakepw\n'

const ROUND_3: Record<string, string> = {
  'r3-sq-G': `${GEMINI}=${SQ}\n`,
  'r3-sq-O': `${OPENROUTER}=${SQ}\n`,
  'r3-sq-both': `${GEMINI}=${SQ}\n${OPENROUTER}=${SQ}\n`,
  'r3-sq-kelvin': `GAUSSMERIDIAN_GEMINI_API_${KELVIN}EY=${SQ}\n`,
  'r3-sq-export': `export ${GEMINI}=${SQ}\n`,
  'r3-sq-set': `set ${GEMINI}=${SQ}\n`,
  'r3-sq-colon': `${GEMINI}:${SQ}\n`,
  'r3-sq-tab': `${GEMINI}\t=${SQ}\n`,
  'r3-sq-lower': `${GEMINI.toLowerCase()}=${SQ}\n`,
  'r3-sq-then-empty': `${GEMINI}=${SQ}\n${GEMINI}=\n`,
  'r3-empty-then-sq': `${GEMINI}=\n${GEMINI}=${SQ}\n`,
  'r3-sq-comment': `${GEMINI}=${SQ} # c\n`,
  'r3-chain-sq-dotted': `${DB}${OPENROUTER}=${SQ}\nGAUSSMER${DOTTED}DIAN_GEMINI_API_KEY=FAKER3A\n`,
  'r3-chain-icu-dotted': `${DB}GAUSS${TATWEEL}MERIDIAN_OPENROUTER_API_KEY=\nGAUSSMER${DOTTED}DIAN_GEMINI_API_KEY=FAKER3B\n`,
  'r3-chain-dotted-lower': `${DB}gaussmer${DOTTED}dian_gemini_api_key=FAKER3C\n`,
  'r3-chain-all-dotted': `${DB}${OPENROUTER}=${SQ}\n${GEMINI.replaceAll('I', DOTTED)}=FAKER3D\n`,
  'r3-export-dotted': `${OPENROUTER}=${SQ}\nexport GAUSSMER${DOTTED}DIAN_GEMINI_API_KEY=FAKER3E\n`,
  'r3-dotted-colon': `${OPENROUTER}=${SQ}\nGAUSSMER${DOTTED}DIAN_GEMINI_API_KEY: FAKER3F\n`,
  'r3-tatweel-val': `GAUSS${TATWEEL}MERIDIAN_GEMINI_API_KEY=FAKER3G\n`,
  'r3-fe73-val': 'GAUSSﹳMERIDIAN_GEMINI_API_KEY=FAKER3H\n',
  'r3-07fa-val': 'GAUSSߺMERIDIAN_GEMINI_API_KEY=FAKER3I\n',
  'r3-180a-val': 'GAUSS᠊MERIDIAN_GEMINI_API_KEY=FAKER3J\n',
  'r3-1cd3-val': 'GAUSS᳓MERIDIAN_GEMINI_API_KEY=FAKER3K\n',
  'r3-0591-val': `GAUSS${ETNAHTA}MERIDIAN_GEMINI_API_KEY=FAKER3L\n`,
  'r3-mark-in-multiline': `A="\nGAUSS${ETNAHTA}MERIDIAN_OPENROUTER_API_KEY=\n"\n`,
  'r3-interp-other': `X=\${${GEMINI}:-FAKER3M}\n`,
  'r3-self-ref': `${GEMINI}=\${${GEMINI}}\n`,

  // a `#` line inside a quoted value: compose reads it as part of the value (or rejects the unclosed one), and
  // neither local-up reader reads it
  'r3-sq-multiline-hash': `A='x\n# ${GEMINI}=FAKER3N\n'\n`,
  'r3-dq-multiline-hash': `A="x\n# ${GEMINI}=FAKER3O\n"\n`,
  'r3-unclosed-then-hash': `A="x\n# ${GEMINI}=FAKER3P\n`,
  'r3-backtick-hash': `A=\`x\n# ${GEMINI}=FAKER3Q\n\`\n`
}

for (const name of BOTH) {
  ;[...name].forEach((letter, at) => {
    if (letter === 'I')
      ROUND_3[`r3-dotted-${name[14]}-${at}`] = `${name.slice(0, at)}${DOTTED}${name.slice(at + 1)}=FAKEDOT\n`
  })
}

Object.assign(REVIEW_FIXTURES, ROUND_3)

export const NOT_SET_FOR_ANY_READER = new Set([
  'r3-sq-multiline-hash',
  'r3-dq-multiline-hash',
  'r3-unclosed-then-hash',
  'r3-backtick-hash'
])

/** About 24 code points from each category the ICU StartsWith skips most of: marks, format and control characters. */
function someOfEachCategory(): string[] {
  const categories = new Map<string, string[]>()
  const tests = ['Mn', 'Mc', 'Me', 'Cf', 'Cc'].map(name => [name, new RegExp(`^\\p{${name}}$`, 'u')] as const)

  for (let point = 0x80; point < 0x110000; point++) {
    if (point >= 0xd800 && point <= 0xdfff) continue
    const char = String.fromCodePoint(point)
    const found = tests.find(([, pattern]) => pattern.test(char))

    if (!found) continue
    if (!categories.has(found[0])) categories.set(found[0], [])
    categories.get(found[0])!.push(char)
  }

  return [...categories.values()].flatMap(list => list.filter((_, at) => at % Math.ceil(list.length / 24) === 0))
}

let differential: Record<string, string> | null = null

/** The reviewers' probes, the unit table, and suspicious characters around, inside and at the end of a name. */
export function differentialTexts(): Record<string, string> {
  if (differential) return differential
  const texts: Record<string, string> = { ...REVIEW_FIXTURES }

  TEXTS.forEach(([text], at) => (texts[`texts[${at}]`] = text))

  for (const char of HIDING) {
    texts[`${label(char)} after the name`] = `${GEMINI}${char}=FAKE\n`
    texts[`${label(char)} before the name`] = `${char}${OPENROUTER}=FAKE\n`
    texts[`${label(char)} as the value`] = `${GEMINI}=${char}\n`
  }

  const ascii = chars(...Array.from({ length: 0x80 }, (_, at) => at).filter(point => point !== 0x0a))

  for (const char of [...ascii, ...HIDING]) {
    texts[`${label(char)} inside the name`] = `${GEMINI.slice(0, 5)}${char}${GEMINI.slice(5)}=FAKE\n`
    texts[`${label(char)} ends the name`] = `${OPENROUTER}${char}=FAKE\n`
  }

  for (const char of someOfEachCategory()) {
    texts[`${label(char)} inside the name`] = `${GEMINI.slice(0, 5)}${char}${GEMINI.slice(5)}=FAKE\n`
  }

  differential = texts

  return texts
}
