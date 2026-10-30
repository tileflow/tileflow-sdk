export type Map1777Moment = 'dawn' | 'dusk' | 'night';

/**
 * Three additional print runs of the day atlas. Each pigment is authored explicitly:
 * dawn uses rose parchment, dusk uses amber paper, night uses indigo paper.
 * SVG engravings and theme tokens share this table so opaque pattern backgrounds
 * cannot leave daylight rectangles on an evening map.
 */
const pigments: Readonly<Record<string, readonly [string, string, string]>> = {
  // Paper, lettering and transport ink.
  '#EFE7CD': ['#E4CDB7', '#BFA386', '#101A27'],
  '#F0E8D2': ['#EBD4BE', '#D9BC9B', '#172331'],
  '#F7F0DD': ['#F0DCC5', '#E0C39E', '#324352'],
  '#39382D': ['#4B3730', '#44343B', '#C6CFD3'],
  '#68624C': ['#7C5D4D', '#72564D', '#8F9EAD'],
  '#625B47': ['#624839', '#5E4646', '#748494'],
  '#9A806B': ['#A47C63', '#95705C', '#7F838A'],
  '#8B4D45': ['#A05A4D', '#8F4F44', '#917073'],
  '#A84E46': ['#B65D50', '#A35247', '#987377'],
  // Oxidised red buildings; night uses a fine silver-blue ink to separate the blocks.
  '#BE5A50': ['#C77563', '#B8624E', '#645D6B'],
  '#AC493E': ['#BC6453', '#AC5142', '#786374'],
  '#86463B': ['#864C42', '#713D39', '#5E6B81'],
  '#AF4C42': ['#BB695A', '#AA594B', '#6A6170'],
  '#C25B4D': ['#C96F60', '#BB5B4B', '#71616F'],
  '#B65349': ['#BE6A5B', '#AC5748', '#5C5666'],
  '#A46C5C': ['#B07968', '#91675B', '#555D6B'],
  '#C96A5A': ['#CF826E', '#C6785D', '#746B7A'],
  // Washed olive land cover.
  '#E5D8AC': ['#CCC09A', '#B7A378', '#2F3938'],
  '#C8C592': ['#BFC19B', '#A5AA79', '#36433A'],
  '#C2CFA7': ['#B5BC98', '#96A17C', '#2B4236'],
  '#E5E7D8': ['#E1D4C2', '#C8C6B6', '#4D6371'],
  '#CFD7B0': ['#C2C7A5', '#A7AF87', '#32463A'],
  '#AABC8A': ['#A9A47C', '#869061', '#223330'],
  '#B7C68D': ['#B6AA80', '#8F9566', '#293A33'],
  '#D4C9AD': ['#C5AF96', '#A99A87', '#37424B'],
  '#E6D5A8': ['#DEC599', '#C8AF77', '#4C4942'],
  '#B7C197': ['#B2A47E', '#979263', '#303833'],
  '#AFC39A': ['#A8B18C', '#849776', '#263E34'],
  '#BFCF9C': ['#B4A97F', '#909865', '#273A33'],
  '#B9CBAA': ['#AFB09A', '#8D9E88', '#223637'],
  '#9FB583': ['#A09A72', '#6F805A', '#192E29'],
  // Land use washes and airfields.
  '#D8B5A2': ['#CBA08E', '#A77E70', '#363747'],
  '#BCC99D': ['#ADA57B', '#839064', '#253430'],
  '#E8DCC3': ['#D9BDA4', '#C1A18B', '#2B323C'],
  '#E5D4BC': ['#D5AE98', '#C39A80', '#312F3A'],
  '#E4DDC1': ['#D0B894', '#B6A079', '#2C373A'],
  '#E7D8BF': ['#D8BAA2', '#C4A08A', '#2D313A'],
  '#D7CFBA': ['#C6AC96', '#A69B8C', '#25303A'],
  '#E8D9C6': ['#D8B5A3', '#C29C8A', '#30303A'],
  '#D4B7AA': ['#CEA28F', '#B28C7E', '#302938'],
  '#E8DFC8': ['#DBC5AC', '#C1AA8D', '#2F3A43'],
  '#ECE0C6': ['#DDC3AA', '#B99B80', '#172332'],
  '#D9D1BD': ['#C4AD96', '#A89C8C', '#233039'],
  '#778B5E': ['#85805B', '#5E7351', '#4B635B'],
  '#ADA186': ['#A58A71', '#8E765F', '#4C5E6B'],
  '#E4DCC6': ['#D6BFA6', '#BAA58A', '#2D3A45'],
  '#B9AB8B': ['#B1977C', '#94816B', '#4F6371'],
  // Roads read as reserved ivory paper; width carries the hierarchy. Paths use pale gravel.
  '#E9E1C9': ['#DCCDB0', '#C8B991', '#43574E'],
  '#F5EEDA': ['#EEE0CA', '#DFCFAF', '#465B69'],
  '#8F8265': ['#86654E', '#8B6C53', '#1D2C3E'],
  '#F6F0DE': ['#F2E3CE', '#E8D7B8', '#72818A'],
  '#F3EDD9': ['#EEE0C9', '#E3D2B3', '#60717C'],
  '#EEE3C9': ['#DCC2A0', '#C7AC85', '#293B4B'],
  '#697858': ['#818360', '#66774F', '#5E7A74'],
  '#8B7454': ['#875A3D', '#956039', '#47443C'],
  '#6F7452': ['#85805B', '#75764C', '#667670'],
  '#9C8868': ['#936F4F', '#97734A', '#334854'],
  '#A19273': ['#9C7E60', '#9C815E', '#314553'],
  '#8A785E': ['#9D7C5B', '#92704D', '#6C7570'],
  '#8E7A61': ['#A17E60', '#9A7D59', '#263B4D'],
  '#EEE5D0': ['#DEC6A7', '#CEB38D', '#33485B'],
  // Grey-green water and depth washes.
  '#CEDCD0': ['#B8C1B7', '#91ABA6', '#102A3E'],
  '#718D7C': ['#617975', '#405F65', '#60889D'],
  // Bank washes absorb light; only their fine outline uses the night silver ink.
  '#718C7D': ['#617975', '#405F65', '#090F19'],
  '#BACDB1': ['#A0ADA7', '#759194', '#10273A'],
  '#AFC5AC': ['#94A39F', '#6B878D', '#0F2437'],
  '#A2BBA3': ['#899997', '#617E86', '#0E2233'],
  '#96B29C': ['#7E8E8E', '#57747E', '#0D2030'],
  '#89A593': ['#738584', '#4E6B76', '#0C1E2E'],
  // Tree volumes; their edge pigment stays dark, separate from label ink.
  '#82985F': ['#878560', '#65764D', '#263E32'],
  '#9AAC73': ['#99926C', '#7A885A', '#354E3D'],
  '#6F8855': ['#787C57', '#526847', '#1C3228'],
  '#4E6541': ['#656C49', '#3F533D', '#11231E'],
  // Engraving-only inks in the original SVG printing plates.
  '#75683F': ['#857044', '#827044', '#69736D'],
  '#A34F45': ['#B65F4C', '#A65E43', '#7E626F'],
  '#696B45': ['#7A754C', '#5F7349', '#577369'],
  '#A05245': ['#B3644C', '#A76747', '#73626A'],
  '#6E784D': ['#84815A', '#697E50', '#496558'],
  '#56603D': ['#697047', '#435E3C', '#617E70'],
  '#9C4A40': ['#AE5948', '#A45A3E', '#816670'],
  '#806D4B': ['#92754F', '#95784D', '#7A7A6C'],
  '#A58B59': ['#B69462', '#A98B56', '#8B8C7E'],
  '#695944': ['#7E5E49', '#705441', '#415A72'],
  '#F2EBD9': ['#FFF0D9', '#E8CFA7', '#486177'],
  '#76664E': ['#8A6D52', '#8D6B4F', '#495F72'],
  '#E6E2CF': ['#EFE0CB', '#D9D4B4', '#768E9F'],
  '#536E66': ['#637970', '#3E6864', '#507079'],
  '#6E7046': ['#827A4F', '#627A4C', '#5D7A69'],
  '#99524C': ['#AF6456', '#974C43', '#6A5B68'],
  '#725E4D': ['#88674F', '#826447', '#536674'],
  '#65704A': ['#7D7E54', '#476749', '#4A6758'],
  '#4D5A3C': ['#626C44', '#33523A', '#5D7B68'],
  '#EEE5CE': ['#F6E1C3', '#DBD3A8', '#818F7F'],
};

export function map1777Pigment(color: string, moment: Map1777Moment): string {
  const variants = pigments[color.toUpperCase()];
  if (!variants) throw new Error(`1777 has no ${moment} pigment for ${color}`);
  return variants[{dawn: 0, dusk: 1, night: 2}[moment]];
}
