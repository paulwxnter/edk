import { Link } from "react-router";
import AsciiArt from "~/ascii/AsciiArt";
import { SiteLayout } from "~/components/chrome";

export const meta = () => [
  { title: "Elements · EDK-1" },
  { name: "description", content: "The measured world EDK-1 is trained on: captures, sun, wind, rock, water, climate, soil, people, buildings, work, industry and distance." },
];

const elements = [
  { id: "captures", name: "Captures", description: "The world as it is seen today. Outerview capture vehicles drive the streets while commercial and open data streams in from across the web, and from both we ingest, detect and discover new objects and conditions as they appear.", fields: ["Outerview vehicle imagery and video", "Commercial and open web data", "Newly detected objects", "Changing conditions on the ground"] },
  { id: "solar", name: "Solar", description: "The sun's daily arc, measured where it lands: how much light reaches the ground, how directly it arrives, and what a well-tilted panel would make of it.", fields: ["Ground-level irradiance", "Direct and diffuse light by hour", "Photovoltaic yield", "Optimal panel tilt"] },
  { id: "wind", name: "Wind", description: "Air in motion, from rooftop height to the sweep of a turbine blade. Five heights reveal where a passing breeze becomes a dependable resource.", fields: ["Mean wind speed", "Speed at five heights", "Wind power density", "Shear with altitude"] },
  { id: "geology", name: "Geology", description: "Beneath every place lies the rock that shaped it. Its type, and the elevation, pitch and bearing of the land above, give a site its physical footing.", fields: ["Surface lithology", "Elevation and relief", "Slope", "Aspect"] },
  { id: "ecology", name: "Ecology", description: "Every place belongs to a living region. Biome, canopy and cover tell what grows there, and how much ground has been sealed beneath pavement and roof.", fields: ["Biomes and ecoregions", "Land cover", "Tree canopy", "Impervious surface"] },
  { id: "water", name: "Water & flooding", description: "Where water rests, where it returns with the seasons, and how deep it could stand when a hundred-year flood arrives, along rivers and at the coast.", fields: ["Proximity to water", "Permanent and seasonal surface water", "River and coastal flood depth", "Distance to coastline"] },
  { id: "climate", name: "Climate & hazards", description: "Decades of temperature and rainfall, distilled into the temperament of a place, with the pressures it lives under: fire weather and the fine particles in its air.", fields: ["Temperature and precipitation normals", "Köppen climate zone", "Wildfire weather and hazard", "Fine particulate matter"] },
  { id: "agriculture", name: "Agriculture & soils", description: "The harvest and the ground that sustains it. Crop cover meets soil that drains or holds, down to the bedrock and the water table below.", fields: ["Cropland and crop type", "Soil drainage and water capacity", "Depth to bedrock and water table", "Mapped soil properties"] },
  { id: "demographics", name: "Demographics", description: "A portrait of the people who call a place home: how many, how old, what they earn, how they are housed and how they reach their work.", fields: ["Population and density", "Household income and housing", "Age and education", "Commuting"] },
  { id: "built-environment", name: "Built environment", description: "The human footprint, from open country to dense core. Height, built-up surface and use give a place its constructed silhouette.", fields: ["Urban and rural settlement", "Building height and built-up area", "Residential and commercial development", "Land use"] },
  { id: "access", name: "Jobs & access", description: "Opportunity, counted in minutes. Where work concentrates and in which sectors, and how quickly a city or a doctor can be reached by road or on foot.", fields: ["Employment by sector", "Job density", "Travel time to cities", "Healthcare access by road and on foot"] },
  { id: "industry", name: "Industrial activity", description: "The working landscape next door: registered facilities, how near and how many, and what each reports releasing into air, water and land.", fields: ["Registered facilities", "Nearest facility", "Facility density", "Reported environmental releases"] },
  { id: "distance", name: "Distance", description: "Measurement across the map itself. How far one thing lies from another, what stands nearest, and what falls within reach.", fields: ["Point-to-point distance", "Nearest features", "Features within a radius", "Comparisons across locations"] },
];

export default function Elements() {
  return (
    <SiteLayout>
      <main className="elements-page">
        <header className="elements-hero art-host">
          <div className="elements-art" aria-hidden="true"><AsciiArt interactive={false} art={[{ scene: "terrain", x: 0.55, y: 0.9, size: 0.85 }]} /></div>
          <div className="elements-intro">
            <Link to="/model" className="label">EDK-1</Link>
            <h1>Elements</h1>
            <p>The measured world EDK-1 is trained on, read thirteen ways.</p>
          </div>
        </header>
        <div className="elements-layout">
          <nav className="elements-sidebar" aria-label="Elements">
            <span className="label">Explore elements</span>
            {elements.map(({ id, name }) => <a key={id} href={`#${id}`}>{name}</a>)}
          </nav>
          <div className="elements-list">
            {elements.map(({ id, name, description, fields }) => (
              <article className="element-row" id={id} key={id}>
                <div><h2>{name}</h2><p>{description}</p></div>
                <ul>{fields.map((field) => <li key={field}>{field}</li>)}</ul>
              </article>
            ))}
          </div>
        </div>
        <footer className="elements-footer">
          <p>Coverage and dates vary by dataset. Values may describe a sampled point, a raster cell, or a census area, depending on the source.</p>
          <Link className="btn btn-primary" to="/atlas">Explore the Atlas</Link>
        </footer>
      </main>
    </SiteLayout>
  );
}
