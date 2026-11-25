// EXTRA THINGS ON THE MAP
//
// Add a line to the list below to put something new in Supreme Town.
// Each line is:  { item: 'what', x: across, y: down }
//
// Finding x and y: in the town, press G. The label in the top-left corner then
// shows the square your mouse is over, for example "Square 12, 27".
//
// What you can add (item names):
//   Furniture:  'plant'  'lamp'  'sofa'  'coffee table'  'bookshelf'
//               'pool table'  'high table'  'lunch table'  'shared table'
//   Seats:      'desk chair'  'armchair'  'bean bag'  'stool'
//   Rides:      'go-kart'  'bike'  'scooter'  'hoverboard'
//   Showpieces: 'globe'  'dna'  'rocket'
//
// Optional extras on a line:
//   color: '#ff6fb5'      the colour, for sofas and seats
//   face: 'x+'            which way it faces: 'y+' towards the front of the
//                         screen, 'y-' away, 'x+' right, 'x-' left
//   label: 'BIOTECH'      the sign over a dna showpiece
//
// After changing this file, run "npm run check" to make sure nothing is on
// top of anything else, then restart the server.

export const EXTRAS = [
  // Examples (remove the two slashes at the start of a line to switch it on):
  // { item: 'plant', x: 14, y: 26 },
  // { item: 'sofa', x: 20, y: 29, color: '#ff6fb5', face: 'y+' },
  // { item: 'go-kart', x: 14, y: 13 },
  // { item: 'armchair', x: 27, y: 39, color: '#27b0e0', face: 'x-' },
];
