import NodeGeocoder from 'node-geocoder';
import fs from 'fs';

// Setup geocoder with OpenStreetMap (no API key needed)
const geocoder = NodeGeocoder({
  provider: 'openstreetmap'
});

// Read your original data
const rawData = JSON.parse(fs.readFileSync('Data with Intensity.json', 'utf8'));

// Get unique cities (filter out blanks)
const uniqueCities = Array.from(new Set(rawData.map(b => b.city).filter(Boolean)));

// Will hold city to coords mapping
const cityCoords = {};

// Helper to delay requests (be nice to the free API)
const delay = ms => new Promise(r => setTimeout(r, ms));

// Main function
(async () => {
  for (const city of uniqueCities) {
    if (!city) continue;
    try {
      // Geocode city in California, USA
      const res = await geocoder.geocode(`${city}, California, USA`);
      if (res.length) {
        cityCoords[city] = {
          lat: res[0].latitude,
          lng: res[0].longitude
        };
        console.log(`✅ ${city}: ${res[0].latitude}, ${res[0].longitude}`);
      } else {
        console.warn(`❌ No result for ${city}`);
      }
    } catch (err) {
      console.error(`Error geocoding ${city}:`, err);
    }
    await delay(1200); // 1.2s delay to avoid throttling
  }

  // Attach lat/lng to each record in the original data
  const newData = rawData.map(b => {
    if (cityCoords[b.city]) {
      return { ...b, lat: cityCoords[b.city].lat, lng: cityCoords[b.city].lng };
    }
    return b;
  });

  fs.writeFileSync('data_with_coords_updated.json', JSON.stringify(newData, null, 2));
  console.log('All done! Data with coordinates saved as data_with_coords.json');
})();
