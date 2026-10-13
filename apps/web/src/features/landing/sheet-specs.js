// Paper, screen and ink for each copy on the light table. Shared by the 3D scene and the SVG
// poster, so it must not import three.js.

// The plies are cut and stacked slightly fanned, so each one's edge shows, but everything printed
// on them is registered to the same frame: in register, their rows and targets coincide.
export const SHEET_SPECS = {
  key: { paper: '#ffffff', screen: '#ffffff', ink: '#3b3650', wet: '#3b3650', tint: 0, paperRect: [0, -0.012, 0.53, 0.735], level: 0.001 },
  you: { paper: '#f6f3ff', screen: '#b9adf5', ink: '#4b3fc4', wet: '#7b6fe8', tint: 0.085, paperRect: [0.038, 0.032, 0.5, 0.707], level: 0.004 },
  ana: { paper: '#fef4f6', screen: '#f2b3c4', ink: '#a42a4b', wet: '#a42a4b', tint: 0.075, paperRect: [0.078, -0.04, 0.5, 0.707], level: 0.007 },
  ben: { paper: '#f2f7fd', screen: '#aecaf0', ink: '#1d5fa8', wet: '#1d5fa8', tint: 0.075, paperRect: [-0.05, 0.066, 0.5, 0.707], level: 0.01 },
  v1: { paper: '#ffffff', screen: '#ffffff', ink: '#6b6684', wet: '#6b6684', tint: 0, paperRect: [0, -0.012, 0.53, 0.735], level: 0 },
  v2: { paper: '#ffffff', screen: '#ffffff', ink: '#5a5670', wet: '#5a5670', tint: 0, paperRect: [0, -0.012, 0.53, 0.735], level: 0 },
  v3: { paper: '#ffffff', screen: '#ffffff', ink: '#4a4660', wet: '#4a4660', tint: 0, paperRect: [0, -0.012, 0.53, 0.735], level: 0 },
};
