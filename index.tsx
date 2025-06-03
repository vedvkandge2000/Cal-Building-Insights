/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Chart, ChartConfiguration, registerables, TooltipItem, InteractionItem } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';
Chart.register(...registerables, zoomPlugin, MatrixController, MatrixElement);

const API_KEY = '';
const GEMINI_MODEL_NAME = "gemini-2.5-flash-preview-04-17";

// Enhanced interfaces for interactivity
interface FilterState {
  departments: string[];
  propertyTypes: string[];
  yearRange: [number, number];
  energyRange: [number, number];
  gfaRange: [number, number];
  leedCertified: string | null;
  searchTerm: string;
  selectedCity: string | null;
}

interface ChartInteractionState {
  selectedItems: BuildingData[];
  highlightedCategories: string[];
  comparisonMode: boolean;
  drillDownLevel: number;
  currentView: string;
  showPercentages: boolean;
}

interface BuildingData {
  department: string;
  departmentName: string;
  propertyId: string;
  propertyName: string;
  yearEnding: string;
  address1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  propertyGFA: number;
  primaryPropertyType: string;
  yearBuilt: number;
  electricityRenewableUsedOnsite: number;
  electricityGridPurchase: number;
  naturalGasUseTherms: number;
  propaneUseKbtu: number;
  waterUseKgal: number;
  percentGreenPower: number;
  greenPowerKWh: number;
  siteEnergyUseKbtu: number;
  leedCertified: string;
  location: string;
  totalElectricityUseKWh: number;
  elecUsedPerSqrFt: number;
  siteEnergyUsedPerSqrFt: number;
  waterUsedPerSqrFt: number;
  hasRenewable: number;
}

let allBuildingData: BuildingData[] = [];
let filteredBuildingData: BuildingData[] = [];
let ai: GoogleGenAI | null = null;
let activeCharts: Chart[] = [];
let currentFilters: FilterState = {
  departments: [],
  propertyTypes: [],
  yearRange: [1900, 2025],
  energyRange: [0, Infinity],
  gfaRange: [0, Infinity],
  leedCertified: null,
  searchTerm: '',
  selectedCity: null
};
let chartInteractionState: ChartInteractionState = {
  selectedItems: [],
  highlightedCategories: [],
  comparisonMode: false,
  drillDownLevel: 0,
  currentView: 'overview',
  showPercentages: true
};

function getNumericValue(value: string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  if (typeof value === 'string') {
    if (value.trim() === "") return 0;
    const num = parseFloat(value.replace(/,/g, '')); // Remove commas before parsing
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

async function fetchDataAndParse(): Promise<BuildingData[]> {
  try {
    const response = await fetch('dataUpdated.json'); 
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const jsonData = await response.json();
    
    // Map the JSON data with actual field names to our camelCase format
    if (Array.isArray(jsonData)) {
      return jsonData.map(item => ({
        department: item.department || "",
        departmentName: item.departmentName || "",
        propertyId: item.propertyId || "",
        propertyName: item.propertyName || "",
        yearEnding: item.yearEnding || "",
        address1: item.address1 || "",
        city: item.city || "",
        stateProvince: item.stateProvince || "",
        postalCode: item.postalCode || "",
        propertyGFA: getNumericValue(item.propertyGFA),
        primaryPropertyType: item.primaryPropertyType || "",
        yearBuilt: getNumericValue(item.yearBuilt),
        electricityRenewableUsedOnsite: getNumericValue(item.electricityRenewableUsedOnsite),
        electricityGridPurchase: getNumericValue(item.electricityGridPurchase),
        naturalGasUseTherms: getNumericValue(item.naturalGasUseTherms),
        propaneUseKbtu: getNumericValue(item.propaneUseKbtu),
        waterUseKgal: getNumericValue(item.waterUseKgal),
        percentGreenPower: getNumericValue(item.percentGreenPower),
        greenPowerKWh: getNumericValue(item.greenPowerKWh),
        siteEnergyUseKbtu: getNumericValue(item.siteEnergyUseKbtu),
        leedCertified: item.leedCertified || "",
        location: item.location || "",
        totalElectricityUseKWh: getNumericValue(item.totalElectricityUseKWh),
        elecUsedPerSqrFt: getNumericValue(item.elecUsedPerSqrFt),
        siteEnergyUsedPerSqrFt: getNumericValue(item.siteEnergyUsedPerSqrFt),
        waterUsedPerSqrFt: getNumericValue(item.waterUsedPerSqrFt),
        hasRenewable: getNumericValue(item.hasRenewable),
      }));
    } else {
      throw new Error('Invalid JSON data format - expected an array');
    }
  } catch (error) {
    console.error("Failed to fetch or parse JSON data:", error);
    const vizContent = document.getElementById('visualization-content')!;
    vizContent.innerHTML = `<p class="error-message">Error loading data. Please check the console and ensure 'data.json' is in the root directory and properly formatted.</p>`;
    return [];
  }
}

function destroyActiveCharts(): void {
  activeCharts.forEach(chart => {
    try {
      chart.destroy();
    } catch (e) {
      console.warn("Error destroying chart:", e);
    }
  });
  activeCharts = [];
}

function renderChart(canvasId: string, config: ChartConfiguration): Chart {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) {
     console.error(`Canvas element with id ${canvasId} not found.`);
     throw new Error(`Canvas element with id ${canvasId} not found.`);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context for ' + canvasId);
  }
  
  // Enhanced configuration for interactivity
  const enhancedConfig: ChartConfiguration = {
    ...config,
    options: {
      ...config.options,
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'nearest',
      },
      plugins: {
        ...config.options?.plugins,
        zoom: {
          pan: {
            enabled: true,
            mode: 'xy',
            modifierKey: 'ctrl',
          },
          zoom: {
            wheel: {
              enabled: false,
            },
            pinch: {
              enabled: true,
            },
            mode: 'xy',
            drag: {
              enabled: true,
              backgroundColor: 'rgba(0, 123, 255, 0.2)',
            },
            limits: {
              x: {min: 'original', max: 'original'},
              y: {min: 'original', max: 'original'},
            },
            scaleMode: 'xy',
          },
        }as any,
        tooltip: {
          ...config.options?.plugins?.tooltip,
          backgroundColor: 'rgba(0, 0, 0, 0.9)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: '#007bff',
          borderWidth: 1,
          cornerRadius: 6,
          displayColors: true,
          titleFont: { size: 14, weight: 'bold' },
          bodyFont: { size: 12 },
          footerFont: { size: 10 },
          padding: 12,
          caretPadding: 8,
        },
        legend: {
          ...config.options?.plugins?.legend,
          position: 'top',
          labels: {
            padding: 20,
            usePointStyle: true,
            font: { size: 12 }
          },
          onClick: (event: any, legendItem: any, legend: any) => {
            // Enhanced legend click to toggle data series
            const chart = legend.chart;
            const index = legendItem.datasetIndex;
            const meta = chart.getDatasetMeta(index);
            
            meta.hidden = meta.hidden === null ? !chart.data.datasets[index].hidden : null;
            chart.update();
            
            // Store interaction state
            chartInteractionState.highlightedCategories = chart.data.datasets
              .map((dataset: any, i: number) => chart.getDatasetMeta(i).hidden ? null : dataset.label)
              .filter((label: string | null) => label !== null);
          }
        }
      },
      onClick: (event: any, elements: InteractionItem[]) => {
        handleChartClick(event, elements, canvasId);
      },
      onHover: (event: any, elements: InteractionItem[]) => {
        const chart = event.chart;
        chart.canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      }
    }
  };
  
  const newChart = new Chart(ctx, enhancedConfig);
  activeCharts.push(newChart);
  return newChart;
}

function handleChartClick(event: any, elements: InteractionItem[], canvasId: string): void {
  if (elements.length === 0) return;
  
  const chart = event.chart;
  const element = elements[0];
  const dataIndex = element.index;
  const datasetIndex = element.datasetIndex;
  
  // Get clicked data point
  const dataset = chart.data.datasets[datasetIndex];
  const label = chart.data.labels?.[dataIndex];
  const value = dataset.data[dataIndex];
  
  console.log('Chart clicked:', { canvasId, label, value, dataIndex, datasetIndex });
  
  // Handle different click actions based on chart type
  if (canvasId.includes('deptDistribution')) {
    handleDepartmentClick(label as string);
  } else if (canvasId.includes('propertyTypes')) {
    handlePropertyTypeClick(label as string);
  } else if (canvasId.includes('energyVsGfa')) {
    handleScatterPointClick(value, dataIndex);
  } else if (canvasId.includes('greenPowerDistribution')) {
    handleGreenPowerBinClick(label as string);
  }
  
  // Show drill-down panel
  showDrillDownPanel(label as string, value, canvasId);
}

function handleDepartmentClick(departmentName: string): void {
  if (currentFilters.departments.includes(departmentName)) {
    currentFilters.departments = currentFilters.departments.filter(d => d !== departmentName);
  } else {
    currentFilters.departments.push(departmentName);
  }
  updateFilteredData();
}

function handlePropertyTypeClick(propertyType: string): void {
  if (currentFilters.propertyTypes.includes(propertyType)) {
    currentFilters.propertyTypes = currentFilters.propertyTypes.filter(t => t !== propertyType);
  } else {
    currentFilters.propertyTypes.push(propertyType);
  }
  updateFilteredData();
}

function handleScatterPointClick(point: any, dataIndex: number): void {
  const buildingData = filteredBuildingData.find((_, index) => index === dataIndex);
  if (buildingData) {
    showBuildingDetailsModal(buildingData);
  }
}

function handleGreenPowerBinClick(binLabel: string): void {
  // Filter based on green power usage range
  switch (binLabel) {
    case '0% Usage':
      currentFilters.energyRange = [0, 0];
      break;
    case '1-25%':
      currentFilters.energyRange = [1, 25];
      break;
    // Add more cases as needed
  }
  updateFilteredData();
}

function showDrillDownPanel(label: string, value: any, chartId: string): void {
  // Close any existing panels first
  const existingPanel = document.getElementById('drill-down-panel');
  if (existingPanel) {
    existingPanel.remove();
  }
  
  // Get related buildings for the clicked category
  const relatedBuildings = getRelatedBuildings(label, chartId);
  
  // Don't show panel if no related buildings found
  if (relatedBuildings.length === 0) {
    console.log('No buildings found for category:', label);
    return;
  }
  
  // Calculate statistics with proper validation
  const totalEnergy = relatedBuildings.reduce((sum, b) => sum + (b.siteEnergyUseKbtu || 0), 0);
  const totalGFA = relatedBuildings.reduce((sum, b) => sum + (b.propertyGFA || 0), 0);
  const avgEnergy = relatedBuildings.length > 0 ? totalEnergy / relatedBuildings.length : 0;
  const avgGFA = relatedBuildings.length > 0 ? totalGFA / relatedBuildings.length : 0;
  
  // Format numbers properly, avoiding NaN
  const formatNumber = (num: number): string => {
    if (isNaN(num) || !isFinite(num) || num === 0) return '0';
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };
  
  const panel = document.createElement('div');
  panel.id = 'drill-down-panel';
  panel.className = 'drill-down-panel';
  
  panel.innerHTML = `
    <div class="drill-down-header">
      <h4>Drill Down: ${label || 'Unknown Category'}</h4>
      <button class="close-drill-down">×</button>
    </div>
    <div class="drill-down-content">
      <div class="drill-down-stats">
        <div class="stat-item">
          <span class="stat-label">Buildings:</span>
          <span class="stat-value">${relatedBuildings.length.toLocaleString()}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg Energy:</span>
          <span class="stat-value">${formatNumber(avgEnergy)} kBtu</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg GFA:</span>
          <span class="stat-value">${formatNumber(avgGFA)} sq ft</span>
        </div>
      </div>
      <div class="drill-down-actions">
        <button class="btn-secondary action-btn" onclick="filterToCategory('${label}', '${chartId}')">
          <i class="fas fa-filter"></i> Filter to This Category
        </button>
        <button class="btn-secondary action-btn" onclick="showBuildingsList('${label}', '${chartId}')">
          <i class="fas fa-list"></i> View Buildings List
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(panel);
  
  // Add close functionality with auto-close when visualization updates
  panel.querySelector('.close-drill-down')?.addEventListener('click', () => {
    panel.remove();
  });
  
  // Close panel when clicking outside
  panel.addEventListener('click', (e) => {
    if (e.target === panel) {
      panel.remove();
    }
  });
}

function getRelatedBuildings(label: string, chartId: string): BuildingData[] {
  if (!label || !chartId) return [];
  
  if (chartId.includes('deptDistribution')) {
    return filteredBuildingData.filter(b => b.departmentName === label);
  } else if (chartId.includes('propertyTypes')) {
    return filteredBuildingData.filter(b => b.primaryPropertyType === label);
  } else if (chartId.includes('cityDistribution')) {
    return filteredBuildingData.filter(b => b.city === label);
  } else if (chartId.includes('buildingAge')) {
    // Handle building age bins
    const buildings = filteredBuildingData.filter(b => {
      const year = b.yearBuilt;
      switch (label) {
        case 'Pre-1900': return year > 0 && year < 1900;
        case '1900-1919': return year >= 1900 && year < 1920;
        case '1920-1939': return year >= 1920 && year < 1940;
        case '1940-1959': return year >= 1940 && year < 1960;
        case '1960-1979': return year >= 1960 && year < 1980;
        case '1980-1999': return year >= 1980 && year < 2000;
        case '2000-Present': return year >= 2000;
        case 'Unknown/Pre-1899': return year === 0 || year === 1899;
        default: return false;
      }
    });
    return buildings;
  } else if (chartId.includes('greenPower')) {
    // Handle green power bins
    const buildings = filteredBuildingData.filter(b => {
      const greenPercent = b.percentGreenPower;
      switch (label) {
        case '0% Usage': return greenPercent === 0;
        case '1-25%': return greenPercent > 0 && greenPercent <= 25;
        case '26-50%': return greenPercent > 25 && greenPercent <= 50;
        case '51-75%': return greenPercent > 50 && greenPercent <= 75;
        case '76-100%': return greenPercent > 75 && greenPercent <= 100;
        default: return false;
      }
    });
    return buildings;
  }
  
  return [];
}

function showBuildingDetailsModal(building: BuildingData): void {
  // Helper function to format values safely
  const formatValue = (value: any, suffix: string = '', defaultValue: string = 'N/A'): string => {
    if (value === null || value === undefined || value === '' || 
        (typeof value === 'number' && (isNaN(value) || !isFinite(value)))) {
      return defaultValue;
    }
    if (typeof value === 'number') {
      return value === 0 ? '0' + suffix : value.toLocaleString() + suffix;
    }
    return String(value);
  };

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content building-details-modal">
      <div class="modal-header">
        <h3>${building.propertyName || 'Unknown Property'}</h3>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div class="building-details-grid">
          <div class="detail-group">
            <h4>Basic Information</h4>
            <div class="detail-item">
              <label>Department:</label>
              <span>${building.departmentName || 'N/A'}</span>
            </div>
            <div class="detail-item">
              <label>Property Type:</label>
              <span>${building.primaryPropertyType || 'N/A'}</span>
            </div>
            <div class="detail-item">
              <label>Address:</label>
              <span>${building.address1 || 'N/A'}, ${building.city || 'N/A'}</span>
            </div>
            <div class="detail-item">
              <label>Year Built:</label>
              <span>${formatValue(building.yearBuilt)}</span>
            </div>
          </div>
          <div class="detail-group">
            <h4>Energy & Environmental</h4>
            <div class="detail-item">
              <label>GFA:</label>
              <span>${formatValue(building.propertyGFA, ' sq ft')}</span>
            </div>
            <div class="detail-item">
              <label>Energy Use:</label>
              <span>${formatValue(building.siteEnergyUseKbtu, ' kBtu')}</span>
            </div>
            <div class="detail-item">
              <label>Green Power:</label>
              <span>${formatValue(building.percentGreenPower, '%')}</span>
            </div>
            <div class="detail-item">
              <label>LEED Certified:</label>
              <span>${building.leedCertified || 'No'}</span>
            </div>
            <div class="detail-item">
              <label>Water Use:</label>
              <span>${formatValue(building.waterUseKgal, ' kgal')}</span>
            </div>
          </div>
        </div>
        <div class="building-actions">
          <button class="btn-primary" onclick="addToComparison('${building.propertyId}'); this.closest('.modal-overlay').remove();">
            <i class="fas fa-plus"></i> Add to Comparison
          </button>
          <button class="btn-secondary" onclick="filterSimilarBuildings('${building.primaryPropertyType}'); this.closest('.modal-overlay').remove();">
            <i class="fas fa-search"></i> Find Similar Buildings
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.modal-close')?.addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function createVisualizationContainer(id: string, title: string): { vizDiv: HTMLDivElement, canvasId: string, storyContainerId: string } {
  const vizDiv = document.createElement('div');
  vizDiv.className = 'visualization-container';
  vizDiv.id = `viz-${id}`;

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  vizDiv.appendChild(titleEl);

  const chartContainer = document.createElement('div');
  chartContainer.className = 'chart-container';

  const canvasId = `chart-${id}`;
chartContainer.innerHTML = `
  <canvas id="${canvasId}" aria-label="${title} Chart" role="img"></canvas>
  <div class="chart-zoom-controls">
    <button class="btn-icon-circle btn-zoom-in" data-chart="${canvasId}" title="Zoom In">
      <i class="fas fa-search-plus"></i>
    </button>
    <button class="btn-icon-circle btn-zoom-out" data-chart="${canvasId}" title="Zoom Out">
      <i class="fas fa-search-minus"></i>
    </button>
    <button class="btn-icon-circle btn-zoom-reset" data-chart="${canvasId}" title="Reset Zoom">
      <i class="fas fa-sync-alt"></i>
    </button>
  </div>
`;

  vizDiv.appendChild(chartContainer);

  const storyContainerId = `story-${id}`;
  const storyDiv = document.createElement('div');
  storyDiv.id = storyContainerId;
  storyDiv.className = 'story-container';
  storyDiv.innerHTML = `<div class="story-loader"><div class="spinner"></div><span>Generating insights...</span></div>`;
  vizDiv.appendChild(storyDiv);

  return { vizDiv, canvasId, storyContainerId };
}


async function generateAndDisplayStory(visualizationTitle: string, chartDescription: string, storyContainerId: string) {
  const storyContainer = document.getElementById(storyContainerId);
  if (!storyContainer) {
      console.warn(`Story container ${storyContainerId} not found.`);
      return;
  }

  const loader = storyContainer.querySelector('.story-loader') as HTMLElement;
  if (loader) loader.style.display = 'flex';
  
  // Remove any existing p or error message before showing loader and new content
  const existingParagraph = storyContainer.querySelector('p');
  if (existingParagraph) existingParagraph.remove();
  const existingError = storyContainer.querySelector('.error-message');
  if (existingError) existingError.remove();


  if (!API_KEY) {
    storyContainer.innerHTML = `<p class="error-message">API key not configured. Story generation disabled.</p>`;
    if (loader) loader.style.display = 'none';
    return;
  }

  if (!ai) {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  }

  const prompt = `You are a data storyteller for an app about California public buildings. Provide a concise, insightful narrative (2-3 sentences, max 100 words) for a visualization titled "${visualizationTitle}". This visualization shows: ${chartDescription}. Highlight a key takeaway or interesting pattern for a general audience. Avoid jargon.`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL_NAME,
      contents: [{ parts: [{ text: prompt }] }],
    });
    const story = response.text;
    const storyP = document.createElement('p');
    storyP.textContent = story ?? '';
    if (loader) loader.style.display = 'none'; // Hide loader before adding text
    storyContainer.appendChild(storyP);

  } catch (error) {
    console.error("Error generating story with Gemini API:", error);
    if (loader) loader.style.display = 'none';
    storyContainer.innerHTML = `<p class="error-message">Could not generate insights at this time.</p>`;
  }
}

// --- Visualization Specific Functions ---

function displayVisualization(viewName: string, data?: BuildingData[]) {
  const dataToUse = data || filteredBuildingData;
  chartInteractionState.currentView = viewName;
  
  const vizArea = document.getElementById('visualization-content')!;
  const loader = document.getElementById('loader')!;
  
  // Update active nav button
  document.querySelectorAll('.nav-button').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`[data-view="${viewName}"]`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Show loader
  loader.style.display = 'flex';
  vizArea.style.display = 'none';
  
  // Clear existing charts
  destroyActiveCharts();
  
  setTimeout(() => {
    try {
      switch (viewName) {
        case 'overview':
          renderOverviewCharts(dataToUse, vizArea);
          break;
        case 'energyConsumption':
          renderEnergyConsumptionCharts(dataToUse, vizArea);
          break;
        case 'greenPower':
          renderGreenPowerCharts(dataToUse, vizArea);
          break;
        case 'waterUsage':
          renderWaterUsageCharts(dataToUse, vizArea);
          break;
        case 'geographicFootprint':
          renderGeographicFootprint(dataToUse, vizArea);
          break;
        case 'buildingAge':
          renderBuildingAge(dataToUse, vizArea);
          break;
        case 'efficiencyAnalysis':
          renderEfficiencyAnalysis(dataToUse, vizArea);
          break;
        default:
          renderOverviewCharts(dataToUse, vizArea);
      }
    } catch (error) {
      console.error('Error rendering visualization:', error);
      vizArea.innerHTML = `<p class="error-message">Error rendering ${viewName} visualization. Please try again.</p>`;
    } finally {
      loader.style.display = 'none';
      vizArea.style.display = 'block';
    }
  }, 100);
}

function renderOverviewCharts(data: BuildingData[], vizArea: HTMLElement) {
  vizArea.innerHTML = ''; 

  // Visualization A: Departmental Distribution with enhanced interactivity
  const deptCounts = data.reduce((acc, item) => {
    const deptName = item.departmentName || "Unknown Department";
    acc[deptName] = (acc[deptName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const sortedDepts = Object.entries(deptCounts).sort(([,a],[,b]) => b-a).slice(0,15);

  const { vizDiv: deptVizDiv, canvasId: deptCanvasId, storyContainerId: deptStoryId } = createVisualizationContainer('deptDistribution', 'Properties by Department (Top 15) - Click to Filter');
  vizArea.appendChild(deptVizDiv);
  
  // Add interactive elements to container
  const interactiveControls = document.createElement('div');
  interactiveControls.className = 'chart-controls';
  interactiveControls.innerHTML = `
    <div class="control-group">
      <button class="btn-sm" onclick="resetDepartmentFilter()">Reset Filter</button>
      <button class="btn-sm" onclick="toggleComparisonMode()">Toggle Compare Mode</button>
      <button class="btn-sm" onclick="exportChartData('departments')">Export Data</button>
    </div>
    <div class="chart-info">
      <i class="fas fa-info-circle"></i> Click on bars to filter data across all charts
    </div>
  `;
  deptVizDiv.appendChild(interactiveControls);
  
  renderChart(deptCanvasId, {
    type: 'bar',
    data: {
      labels: sortedDepts.map(d => d[0]),
      datasets: [{
        label: 'Number of Properties',
        data: sortedDepts.map(d => d[1]),
        backgroundColor: sortedDepts.map(([deptName]) => 
          currentFilters.departments.includes(deptName) ? 'rgba(0, 123, 255, 1)' : 'rgba(0, 123, 255, 0.7)'
        ),
        borderColor: 'rgba(0, 123, 255, 1)',
        borderWidth: 1,
        hoverBackgroundColor: 'rgba(0, 123, 255, 0.9)',
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      indexAxis: 'y', 
      scales: { 
        y: { 
          ticks: { 
            autoSkip: false, 
            font: {size: 10},
            callback: function(value: any, index: number) {
              const label = this.getLabelForValue(value);
              return label.length > 20 ? label.substring(0, 20) + '...' : label;
            }
          } 
        },
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Number of Properties'
          }
        }
      },
      plugins: { 
        tooltip: { 
          displayColors: false, 
          titleFont: {size: 12}, 
          bodyFont: {size: 11},
          callbacks: {
            afterBody: function(context: any) {
              const deptName = context[0].label;
              const deptBuildings = data.filter(b => b.departmentName === deptName);
              const avgEnergy = deptBuildings.length > 0 ? 
                deptBuildings.reduce((sum, b) => sum + b.siteEnergyUseKbtu, 0) / deptBuildings.length : 0;
              return [
                `Avg Energy: ${avgEnergy.toLocaleString()} kBtu`,
                `Click to filter to this department`
              ];
            }
          }
        }
      }
    }
  });
  generateAndDisplayStory('Properties by Department (Top 15)', 'Interactive bar chart showing the number of properties per state department. Click on bars to filter data across all visualizations.', deptStoryId);

  // Enhanced Property Type Visualization
  const typeCounts = data.reduce((acc, item) => {
    const typeName = item.primaryPropertyType || "Unknown Type";
    acc[typeName] = (acc[typeName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const sortedTypes = Object.entries(typeCounts).sort(([,a],[,b]) => b-a).slice(0,10);

  const { vizDiv: typeVizDiv, canvasId: typeCanvasId, storyContainerId: typeStoryId } = createVisualizationContainer('propertyTypes', 'Properties by Primary Type (Top 10) - Interactive');
  vizArea.appendChild(typeVizDiv);
  
  // Add property type controls
  const typeControls = document.createElement('div');
  typeControls.className = 'chart-controls';
  typeControls.innerHTML = `
    <div class="control-group">
      <button class="btn-sm" onclick="resetPropertyTypeFilter()">Reset Filter</button>
      <button class="btn-sm" onclick="showPropertyTypeBreakdown()">Detailed Breakdown</button>
    </div>
    <div class="chart-legend-toggle">
      <label>
        <input type="checkbox" id="show-percentages-${typeCanvasId}" checked> Show Percentages
      </label>
    </div>
  `;
  typeVizDiv.appendChild(typeControls);
  
  const typeChart = renderChart(typeCanvasId, {
    type: 'doughnut',
    data: {
      labels: sortedTypes.map(t => t[0]),
      datasets: [{
        label: 'Property Types',
        data: sortedTypes.map(t => t[1]),
        backgroundColor: [
          '#007bff', '#28a745', '#ffc107', '#dc3545', '#17a2b8', 
          '#6c757d', '#fd7e14', '#6610f2', '#20c997', '#e83e8c'
        ],
        borderWidth: 2,
        borderColor: '#fff',
        hoverBorderWidth: 3,
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false,
      plugins: { 
        tooltip: { 
          displayColors: true, 
          titleFont: {size: 12}, 
          bodyFont: {size: 11},
          callbacks: {
            label: function(context: any) {
              const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
              const percentage = ((context.parsed / total) * 100).toFixed(1);
              const showPercentages = chartInteractionState.showPercentages;
              if (showPercentages) {
                return `${context.label}: ${context.parsed} buildings (${percentage}%)`;
              } else {
                return `${context.label}: ${context.parsed} buildings`;
              }
            },
            afterBody: function() {
              return 'Click segment to filter';
            }
          }
        },
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            usePointStyle: true,
            generateLabels: function(chart: any) {
              const data = chart.data;
              if (data.labels.length && data.datasets.length) {
                return data.labels.map((label: string, i: number) => {
                  const total = data.datasets[0].data.reduce((a: number, b: number) => a + b, 0);
                  const value = data.datasets[0].data[i];
                  const percentage = ((value / total) * 100).toFixed(1);
                  const showPercentages = chartInteractionState.showPercentages;
                  return {
                    text: showPercentages ? `${label} (${percentage}%)` : `${label} (${value})`,
                    fillStyle: data.datasets[0].backgroundColor[i],
                    index: i
                  };
                });
              }
              return [];
            }
          },
          title: {
            display: true,
            text: 'Darker shades indicate buildings with renewable energy'
          }
        }
      }
    }
  });
  
  // Add event listener for show percentages checkbox
  const showPercentagesCheckbox = document.getElementById(`show-percentages-${typeCanvasId}`) as HTMLInputElement;
  if (showPercentagesCheckbox) {
    showPercentagesCheckbox.addEventListener('change', (e) => {
      chartInteractionState.showPercentages = (e.target as HTMLInputElement).checked;
      typeChart.update();
    });
  }
  
  generateAndDisplayStory('Properties by Primary Type (Top 10)', 'Interactive donut chart showing the breakdown of properties by primary type. Click on segments to filter the dataset.', typeStoryId);
}

function renderEnergyConsumptionCharts(data: BuildingData[], vizArea: HTMLElement) {
  vizArea.innerHTML = '';

  const filteredScatterData = data
    .filter(d => d.propertyGFA > 100 && d.propertyGFA < 1000000 && d.siteEnergyUseKbtu > 1000 && d.siteEnergyUseKbtu < 50000000) 
    .map(d => ({ 
        x: d.propertyGFA, 
        y: d.siteEnergyUseKbtu, 
        type: d.primaryPropertyType || "Unknown", 
        name: d.propertyName || "Unknown Property"
    }));
  
  const propertyTypes = [...new Set(filteredScatterData.map(d => d.type))];
  const colorPalette = ['#007bff', '#28a745', '#ffc107', '#dc3545', '#17a2b8', '#6c757d', '#fd7e14', '#6610f2', '#20c997', '#e83e8c', '#343a40', '#adb5bd'];
  const typeColorMap = propertyTypes.reduce((acc, type, i) => {
    acc[type] = colorPalette[i % colorPalette.length];
    return acc;
  }, {} as Record<string, string>);

  const { vizDiv: scatterVizDiv, canvasId: scatterCanvasId, storyContainerId: scatterStoryId } = createVisualizationContainer('energyVsGfa', 'Site Energy Use vs. Property GFA');
  vizArea.appendChild(scatterVizDiv);
  renderChart(scatterCanvasId, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Building',
        data: filteredScatterData,
        backgroundColor: filteredScatterData.map(d => typeColorMap[d.type] || '#adb5bd'),
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { title: { display: true, text: 'Property GFA (sq ft)' } }, y: { title: { display: true, text: 'Site Energy Use (kBtu)' } } },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context: TooltipItem<'scatter'>) {
              const item = context.raw as { name: string; x: number; y: number; type: string };
              return `${item.name}: GFA: ${item.x.toLocaleString()} sq ft, Energy: ${item.y.toLocaleString()} kBtu, Type: ${item.type}`;
            }
          }
        }
      }
    }
  });
  generateAndDisplayStory('Energy Use vs. Building Size', `A scatter plot of Site Energy Use (kBtu) against Property GFA (sq ft), color-coded by primary property type. Data filtered for GFA between 100 and 1,000,000 sq ft, and Energy Use between 1,000 and 50,000,000 kBtu. This helps visualize energy intensity.`, scatterStoryId);

  const topEnergyConsumers = [...data]
    .filter(d => d.siteEnergyUseKbtu > 0)
    .sort((a, b) => b.siteEnergyUseKbtu - a.siteEnergyUseKbtu)
    .slice(0, 10);

  const { vizDiv: topEnergyVizDiv, canvasId: topEnergyCanvasId, storyContainerId: topEnergyStoryId } = createVisualizationContainer('topEnergyConsumers', 'Top 10 Energy Consuming Properties');
  vizArea.appendChild(topEnergyVizDiv);
  renderChart(topEnergyCanvasId, {
    type: 'bar',
    data: {
      labels: topEnergyConsumers.map(d => `${(d.propertyName || "Unknown Property").substring(0,25)}... (${(d.departmentName || "N/A Dept.").substring(0,15)}...)`),
      datasets: [{
        label: 'Site Energy Use (kBtu)',
        data: topEnergyConsumers.map(d => d.siteEnergyUseKbtu),
        backgroundColor: 'rgba(220, 53, 69, 0.7)',
        borderColor: 'rgba(220, 53, 69, 1)',
        borderWidth: 1
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { y: { ticks: { autoSkip: false, font: {size: 9} } } } }
  });
  generateAndDisplayStory('Top Energy Consumers', 'A horizontal bar chart showing the top 10 properties by Site Energy Use (kBtu).', topEnergyStoryId);
//   const mapSection = document.createElement("section");
// mapSection.innerHTML = `
//   <h2 style="text-align:center;margin-top:30px;">California Building Energy Consumption by City</h2>
//   <div style="display: flex; justify-content: center;">
//     <div id="city-energy-map" style="width: 1000px; height: 540px; border-radius: 10px; margin: 20px 0;"></div>
//   </div>
// `;
// vizArea.appendChild(mapSection);
// renderCaliforniaCityEnergyMap(filteredBuildingData, 'total');
}

function renderGreenPowerCharts(data: BuildingData[], vizArea: HTMLElement) {
  vizArea.innerHTML = '';

  const greenPowerBins: Record<string, number> = { '0% Usage': 0, '1-25%': 0, '26-50%': 0, '51-75%': 0, '76-100%': 0, 'Not Reported/Applicable': 0 };
  data.forEach(d => {
    if (d.totalElectricityUseKWh > 0) { // Only consider properties that use electricity
        if (d.percentGreenPower === 0) greenPowerBins['0% Usage']++;
        else if (d.percentGreenPower > 0 && d.percentGreenPower <= 25) greenPowerBins['1-25%']++;
        else if (d.percentGreenPower > 25 && d.percentGreenPower <= 50) greenPowerBins['26-50%']++;
        else if (d.percentGreenPower > 50 && d.percentGreenPower <= 75) greenPowerBins['51-75%']++;
        else if (d.percentGreenPower > 75 && d.percentGreenPower <= 100) greenPowerBins['76-100%']++;
        else greenPowerBins['Not Reported/Applicable']++; // Catches non-zero electricity users with missing/non-standard % green power
    } else {
      // Optionally, count properties that don't use electricity if that's insightful
      // greenPowerBins['No Electricity Use'] = (greenPowerBins['No Electricity Use'] || 0) + 1;
    }
  });
  
  const { vizDiv: greenPctVizDiv, canvasId: greenPctCanvasId, storyContainerId: greenPctStoryId } =
  createVisualizationContainer('greenPowerDistribution', 'Green Power Usage Distribution');
vizArea.appendChild(greenPctVizDiv);

// --- Create Logarithmic toggle, add above chart ---
const logToggleDiv = document.createElement('div');
logToggleDiv.style.margin = '0.5rem 0';

const logToggle = document.createElement('input');
logToggle.type = 'checkbox';
logToggle.id = 'logToggle';

const logLabel = document.createElement('label');
logLabel.htmlFor = 'logToggle';
logLabel.style.marginLeft = '0.25rem';
logLabel.innerText = 'Logarithmic Y-Axis';

logToggleDiv.appendChild(logToggle);
logToggleDiv.appendChild(logLabel);
greenPctVizDiv.prepend(logToggleDiv);

// --- Chart.js config object (reuse for toggling) ---
const greenPowerConfig: ChartConfiguration<'bar'> = {
  type: 'bar',
  data: {
    labels: Object.keys(greenPowerBins),
    datasets: [{
      label: 'Number of Properties',
      data: Object.values(greenPowerBins),
      backgroundColor: (context: any) => {
        const label = context.chart.data.labels[context.dataIndex] as string;
        if (label === '0% Usage') return 'rgba(220, 53, 69, 0.7)';
        if (label === 'Not Reported/Applicable') return 'rgba(108, 117, 125, 0.7)';
        return 'rgba(40, 167, 69, 0.7)';
      },
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: { displayColors: false }
    },
    scales: {
      y: {
        type: 'linear',
        min: 1,
        title: {
          display: true,
          text: 'Number of Properties'
        },
        ticks: {
          callback: function(value: string | number) {
            // Typescript-friendly tick formatting
            if (typeof value === 'number') {
              return value.toLocaleString();
            }
            return value;
          }
        }
      }
    }
  }
};

// --- 2. Render the chart (ensure renderChart returns Chart instance) ---
const myChart = renderChart(greenPctCanvasId, greenPowerConfig);

// --- 3. Toggle handler (just use logToggle, no redeclaration) ---
logToggle.addEventListener('change', function (e) {
  // e.target always HTMLInputElement in this context
  if (!myChart.options.scales || !myChart.options.scales.y) return;
  const isLog = logToggle.checked;
  myChart.options.scales.y.type = isLog ? 'logarithmic' : 'linear';
  myChart.options.scales.y.min = isLog ? 1 : 0;
  myChart.update();
});

  generateAndDisplayStory('Green Power Adoption', 'Distribution of properties by green power usage. "0% Usage" indicates properties using grid electricity but no reported green power. "Not Reported/Applicable" includes properties with non-standard green power data.', greenPctStoryId);

  const leedCounts: Record<string, number> = { 'Certified': 0, 'Not Certified': 0 };
  data.forEach(item => {
    const leedStatus = item.leedCertified ? item.leedCertified.trim().toLowerCase() : "";
    if (leedStatus && leedStatus !== 'no' && leedStatus !== 'not applicable' && leedStatus !== '') {
        leedCounts['Certified']++;
    } else {
        leedCounts['Not Certified']++;
    }
  });
  const { vizDiv: leedVizDiv, canvasId: leedCanvasId, storyContainerId: leedStoryId } = createVisualizationContainer('leedCertification', 'LEED Certification Status');
  vizArea.appendChild(leedVizDiv);
  renderChart(leedCanvasId, {
    type: 'pie',
    data: {
      labels: Object.keys(leedCounts),
      datasets: [{
        data: Object.values(leedCounts),
        backgroundColor: [ 'rgba(40, 167, 69, 0.7)', 'rgba(220, 53, 69, 0.5)'],
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { displayColors: true }}}
  });
  generateAndDisplayStory('LEED Certification Status', 'Proportion of properties that are LEED Certified (any level) versus Not Certified or Not Applicable.', leedStoryId);
}

function renderWaterUsageCharts(data: BuildingData[], vizArea: HTMLElement) {
  vizArea.innerHTML = '';

  const waterUsePositive = data.filter(d => d.waterUseKgal > 0);
  let waterBins: Record<string, number> = {};
  let chartDescriptionWaterDist = 'A histogram showing the distribution of water usage (kgal) across properties.';

  if (waterUsePositive.length > 0) {
    const maxWaterUse = Math.max(...waterUsePositive.map(d => d.waterUseKgal));
    const numBins = 10;
    const binSize = Math.ceil(maxWaterUse / numBins) || 100; // Ensure binSize is at least 100 or sensible
    
    waterUsePositive.forEach(d => {
        const binStart = Math.floor(d.waterUseKgal / binSize) * binSize;
        const binEnd = binStart + binSize -1;
        const binLabel = `${binStart.toLocaleString()}-${binEnd.toLocaleString()} kgal`;
        waterBins[binLabel] = (waterBins[binLabel] || 0) + 1;
    });
    const sortedWaterBins = Object.entries(waterBins).sort(([keyA], [keyB]) => parseInt(keyA.split('-')[0].replace(/,/g, '')) - parseInt(keyB.split('-')[0].replace(/,/g, '')));
    waterBins = Object.fromEntries(sortedWaterBins); // Recreate object with sorted keys for chart labels
    chartDescriptionWaterDist = `A histogram showing the distribution of water usage (kgal) across properties using water. Max usage approx ${maxWaterUse.toLocaleString()} kgal. Binned into ${Object.keys(waterBins).length} groups.`;
  } else {
    waterBins["No Water Usage Data"] = 0;
    chartDescriptionWaterDist = 'No properties with reported water usage greater than 0 kgal found in the dataset.';
  }


  const { vizDiv: waterHistVizDiv, canvasId: waterHistCanvasId, storyContainerId: waterHistStoryId } =
  createVisualizationContainer('waterUsageDistribution', 'Water Usage Distribution (kgal)');
vizArea.appendChild(waterHistVizDiv);

// --- Create Logarithmic toggle, add above chart ---
const waterLogToggleDiv = document.createElement('div');
waterLogToggleDiv.style.margin = '0.5rem 0';

const waterLogToggle = document.createElement('input');
waterLogToggle.type = 'checkbox';
waterLogToggle.id = 'waterLogToggle';

const waterLogLabel = document.createElement('label');
waterLogLabel.htmlFor = 'waterLogToggle';
waterLogLabel.style.marginLeft = '0.25rem';
waterLogLabel.innerText = 'Logarithmic Y-Axis';

waterLogToggleDiv.appendChild(waterLogToggle);
waterLogToggleDiv.appendChild(waterLogLabel);
waterHistVizDiv.prepend(waterLogToggleDiv);

// --- Chart.js config object (reuse for toggling) ---
const waterUsageConfig: ChartConfiguration<'bar'> = {
  type: 'bar',
  data: {
    labels: Object.keys(waterBins),
    datasets: [{
      label: 'Number of Properties',
      data: Object.values(waterBins),
      backgroundColor: 'rgba(23, 162, 184, 0.7)',
      borderColor: 'rgba(0,0,0,0.7)', // Black border for every bar
      borderWidth: 0,
      barPercentage: 0.8,
      categoryPercentage: 0.8,
      // The below makes sure Chart.js doesn't skip borders for tiny values
      borderSkipped: false,
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: {
          autoSkip: false,
          maxRotation: 45,
          minRotation: 45,
          font: { size: 9 }
        }
      },
      y: {
        type: 'linear',
        min: 1,
        title: {
          display: true,
          text: 'Number of Properties'
        },
        ticks: {
          callback: function(value: string | number) {
            if (typeof value === 'number') {
              return value.toLocaleString();
            }
            return value;
          }
        }
      }
    }
  },
  // This plugin forcibly draws a small bar even for value 1 (optional, advanced)
  plugins: [{
    id: 'minBarHeight',
    afterDatasetDraw(chart, args, options) {
      const { ctx, chartArea: area } = chart;
      const dataset = chart.getDatasetMeta(0);
      dataset.data.forEach((bar, i) => {
        const value = chart.data.datasets[0].data[i];
        if (value === 1 && chart.options.scales && chart.options.scales.y && chart.options.scales.y.type === 'logarithmic') {
          // Draw a tiny filled rect for visibility if needed
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          const barElement = bar as any;
          const barWidth = barElement.width;
          const barX = barElement.x - barElement.width / 2;
          const barY = barElement.y - 2;
          
          ctx.fillRect(barX, barY, barWidth, 2);
          ctx.restore();
        }
      });
    }
  }]
};

// --- 2. Render the chart (ensure renderChart returns Chart.js instance) ---
const waterChart = renderChart(waterHistCanvasId, waterUsageConfig);

// --- 3. Toggle handler (no redeclaration!) ---
waterLogToggle.addEventListener('change', function () {
  if (!waterChart.options.scales || !waterChart.options.scales.y) return;
  const isLog = waterLogToggle.checked;
  waterChart.options.scales.y.type = isLog ? 'logarithmic' : 'linear';
  waterChart.options.scales.y.min = isLog ? 1 : 0;
  waterChart.update();
});


  generateAndDisplayStory('Water Usage Distribution', chartDescriptionWaterDist, waterHistStoryId);


  const topWaterConsumers = [...data]
    .filter(d => d.waterUseKgal > 0)
    .sort((a, b) => b.waterUseKgal - a.waterUseKgal)
    .slice(0, 10);
  const { vizDiv: topWaterVizDiv, canvasId: topWaterCanvasId, storyContainerId: topWaterStoryId } = createVisualizationContainer('topWaterConsumers', 'Top 10 Water Consuming Properties');
  vizArea.appendChild(topWaterVizDiv);
  renderChart(topWaterCanvasId, {
    type: 'bar',
    data: {
      labels: topWaterConsumers.map(d => `${(d.propertyName || "Unknown Property").substring(0,30)}...`),
      datasets: [{
        label: 'Water Use (kgal)',
        data: topWaterConsumers.map(d => d.waterUseKgal),
        backgroundColor: 'rgba(23, 162, 184, 0.7)',
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { y: { ticks: { autoSkip: false, font: {size: 9} } } } }
  });
  generateAndDisplayStory('Top Water Consumers', 'A horizontal bar chart of the top 10 properties by water usage (kgal).', topWaterStoryId);
}

function renderGeographicFootprint(data: BuildingData[], vizArea: HTMLElement) {
  vizArea.innerHTML = '';

  const cityCounts = data.reduce((acc, item) => {
    const city = item.city || "Unknown City";
    acc[city] = (acc[city] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedCities = Object.entries(cityCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20); 

  const { vizDiv, canvasId, storyContainerId } = createVisualizationContainer('cityDistribution', 'Property Counts by City (Top 20)');
  vizArea.appendChild(vizDiv);
  renderChart(canvasId, {
    type: 'bar',
    data: {
      labels: sortedCities.map(entry => entry[0]),
      datasets: [{
        label: 'Number of Properties',
        data: sortedCities.map(entry => entry[1]),
        backgroundColor: 'rgba(108, 117, 125, 0.7)',
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { y: { ticks: { autoSkip: false, font: {size: 10} } } } }
  });
  generateAndDisplayStory('Geographic Footprint', 'A horizontal bar chart showing the number of public buildings in the top 20 cities in California.', storyContainerId);
}

function renderBuildingAge(data: BuildingData[], vizArea: HTMLElement) {
  vizArea.innerHTML = '';

  const yearBins: Record<string, number> = {
    "Pre-1900":0, "1900-1919":0, "1920-1939":0, "1940-1959":0, 
    "1960-1979":0, "1980-1999":0, "2000-Present":0, "Unknown/Pre-1899":0
  };

  data.forEach(d => {
    const year = d.yearBuilt;
    if (year === 0 || year === 1899) yearBins["Unknown/Pre-1899"]++; 
    else if (year < 1900) yearBins["Pre-1900"]++;
    else if (year < 1920) yearBins["1900-1919"]++;
    else if (year < 1940) yearBins["1920-1939"]++;
    else if (year < 1960) yearBins["1940-1959"]++;
    else if (year < 1980) yearBins["1960-1979"]++;
    else if (year < 2000) yearBins["1980-1999"]++;
    else yearBins["2000-Present"]++;
  });
  
  const { vizDiv, canvasId, storyContainerId } = createVisualizationContainer('buildingAgeDistribution', 'Building Age Distribution');
  vizArea.appendChild(vizDiv);
  renderChart(canvasId, {
    type: 'bar',
    data: {
      labels: Object.keys(yearBins),
      datasets: [{
        label: 'Number of Properties',
        data: Object.values(yearBins),
        backgroundColor: 'rgba(253, 126, 20, 0.7)',
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, scales: {x: { ticks: {font: {size:10}}}}}
  });
  generateAndDisplayStory('Building Age Distribution', 'A bar chart showing the distribution of public buildings by their construction decade. "Unknown/Pre-1899" includes properties with year built listed as 1899 (often a placeholder) or 0.', storyContainerId);
}

function renderEfficiencyAnalysis(data: BuildingData[], vizArea: HTMLElement) {
  vizArea.innerHTML = '';

  // 1. Energy Intensity Distribution (Energy per Sq Ft)
  const energyIntensityData = data
    .filter(d => d.siteEnergyUsedPerSqrFt > 0 && d.siteEnergyUsedPerSqrFt < 1000 && d.propertyGFA > 100)
    .map(d => d.siteEnergyUsedPerSqrFt);

  const energyIntensityBins: Record<string, number> = {};
  if (energyIntensityData.length > 0) {
    const maxIntensity = Math.max(...energyIntensityData);
    const binSize = Math.ceil(maxIntensity / 15) || 10;
    
    energyIntensityData.forEach(intensity => {
      const binStart = Math.floor(intensity / binSize) * binSize;
      const binEnd = binStart + binSize - 1;
      const binLabel = `${binStart}-${binEnd}`;
      energyIntensityBins[binLabel] = (energyIntensityBins[binLabel] || 0) + 1;
    });
  }

  const { vizDiv: energyIntensityVizDiv, canvasId: energyIntensityCanvasId, storyContainerId: energyIntensityStoryId } =
  createVisualizationContainer('energyIntensityDistribution', 'Energy Intensity Distribution (kBtu/sq ft)');
vizArea.appendChild(energyIntensityVizDiv);

// --- Create Logarithmic toggle, add above chart ---
const energyLogToggleDiv = document.createElement('div');
energyLogToggleDiv.style.margin = '0.5rem 0';

const energyLogToggle = document.createElement('input');
energyLogToggle.type = 'checkbox';
energyLogToggle.id = 'energyLogToggle';

const energyLogLabel = document.createElement('label');
energyLogLabel.htmlFor = 'energyLogToggle';
energyLogLabel.style.marginLeft = '0.25rem';
energyLogLabel.innerText = 'Logarithmic Y-Axis';

energyLogToggleDiv.appendChild(energyLogToggle);
energyLogToggleDiv.appendChild(energyLogLabel);
energyIntensityVizDiv.prepend(energyLogToggleDiv);

// --- Chart.js config object (reuse for toggling) ---
const energyIntensityConfig: ChartConfiguration<'bar'> = {
  type: 'bar',
  data: {
    labels: Object.keys(energyIntensityBins),
    datasets: [{
      label: 'Number of Properties',
      data: Object.values(energyIntensityBins),
      backgroundColor: 'rgba(255, 99, 132, 0.7)',
      borderColor: 'rgba(255, 99, 132, 1)',
      borderWidth: 0,
      minBarLength: 6
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        displayColors: false,
        callbacks: {
          afterBody: function(context: any) {
            return 'Lower values indicate more energy-efficient buildings';
          }
        }
      }
    },
    scales: {
      x: {
        title: { display: true, text: 'Energy Intensity (kBtu/sq ft)' },
        ticks: { maxRotation: 45, font: { size: 9 } }
      },
      y: {
        type: 'linear',
        min: 1,
        title: { display: true, text: 'Number of Properties' },
        ticks: {
          callback: function(value: string | number) {
            // Typescript-friendly tick formatting
            if (typeof value === 'number') return value.toLocaleString();
            return value;
          }
        }
      }
    }
  }
};

// --- Render the chart and store reference ---
const energyIntensityChart = renderChart(energyIntensityCanvasId, energyIntensityConfig);

// --- Toggle handler (no redeclaration) ---
energyLogToggle.addEventListener('change', function () {
  if (!energyIntensityChart.options.scales || !energyIntensityChart.options.scales.y) return;
  const isLog = energyLogToggle.checked;
  energyIntensityChart.options.scales.y.type = isLog ? 'logarithmic' : 'linear';
  energyIntensityChart.options.scales.y.min = isLog ? 1 : 0;
  energyIntensityChart.update();
});

  generateAndDisplayStory('Energy Efficiency Distribution', 'Distribution of energy intensity (kBtu per square foot) across buildings. Lower values indicate more energy-efficient properties.', energyIntensityStoryId);

  // 2. Water Efficiency vs Energy Efficiency Scatter Plot
  const efficiencyScatterData = data
    .filter(d => d.waterUsedPerSqrFt > 0 && d.waterUsedPerSqrFt < 100 && 
               d.siteEnergyUsedPerSqrFt > 0 && d.siteEnergyUsedPerSqrFt < 500)
    .map(d => ({
      x: d.waterUsedPerSqrFt,
      y: d.siteEnergyUsedPerSqrFt,
      hasRenewable: d.hasRenewable > 0,
      name: d.propertyName || "Unknown Property",
      type: d.primaryPropertyType || "Unknown Type",
      leedCertified: d.leedCertified && d.leedCertified.toLowerCase() !== 'no' && d.leedCertified.toLowerCase() !== 'not applicable'
    }));

  const { vizDiv: efficiencyScatterVizDiv, canvasId: efficiencyScatterCanvasId, storyContainerId: efficiencyScatterStoryId } = 
    createVisualizationContainer('efficiencyScatter', 'Water vs Energy Efficiency Analysis');
  vizArea.appendChild(efficiencyScatterVizDiv);

  renderChart(efficiencyScatterCanvasId, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Buildings with Renewable Energy',
          data: efficiencyScatterData.filter(d => d.hasRenewable),
          backgroundColor: 'rgba(40, 167, 69, 0.6)',
          borderColor: 'rgba(40, 167, 69, 1)',
          pointRadius: 6,
          pointHoverRadius: 8,
        },
        {
          label: 'LEED Certified Buildings',
          data: efficiencyScatterData.filter(d => d.leedCertified && !d.hasRenewable),
          backgroundColor: 'rgba(0, 123, 255, 0.6)',
          borderColor: 'rgba(0, 123, 255, 1)',
          pointRadius: 6,
          pointHoverRadius: 8,
        },
        {
          label: 'Other Buildings',
          data: efficiencyScatterData.filter(d => !d.hasRenewable && !d.leedCertified),
          backgroundColor: 'rgba(108, 117, 125, 0.4)',
          borderColor: 'rgba(108, 117, 125, 1)',
          pointRadius: 4,
          pointHoverRadius: 6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'Water Use per Sq Ft (gallons/sq ft)' },
          beginAtZero: true
        },
        y: {
          title: { display: true, text: 'Energy Use per Sq Ft (kBtu/sq ft)' },
          beginAtZero: true
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context: TooltipItem<'scatter'>) {
              const point = context.raw as any;
              return [
                `${point.name}`,
                `Water: ${point.x.toFixed(2)} gal/sq ft`,
                `Energy: ${point.y.toFixed(2)} kBtu/sq ft`,
                `Type: ${point.type}`
              ];
            }
          }
        },
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 20
          }
        }
      }
    }
  });
  generateAndDisplayStory('Efficiency Correlation Analysis', 'Scatter plot showing the relationship between water and energy efficiency. Buildings with renewable energy and LEED certification are highlighted to identify sustainability leaders.', efficiencyScatterStoryId);

  // 3. Renewable Energy Adoption by Property Type
  const renewableByType = data.reduce((acc, building) => {
    const type = building.primaryPropertyType || 'Unknown Type';
    if (!acc[type]) {
      acc[type] = { total: 0, withRenewable: 0 };
    }
    acc[type].total++;
    if (building.hasRenewable > 0) {
      acc[type].withRenewable++;
    }
    return acc;
  }, {} as Record<string, { total: number; withRenewable: number }>);

  const renewableAdoptionData = Object.entries(renewableByType)
    .filter(([_, stats]) => stats.total >= 5) // Only show types with at least 5 buildings
    .map(([type, stats]) => ({
      type,
      adoptionRate: (stats.withRenewable / stats.total) * 100,
      total: stats.total,
      withRenewable: stats.withRenewable
    }))
    .sort((a, b) => b.adoptionRate - a.adoptionRate)
    .slice(0, 12);

  const { vizDiv: renewableAdoptionVizDiv, canvasId: renewableAdoptionCanvasId, storyContainerId: renewableAdoptionStoryId } = 
    createVisualizationContainer('renewableAdoption', 'Renewable Energy Adoption by Property Type');
  vizArea.appendChild(renewableAdoptionVizDiv);

  renderChart(renewableAdoptionCanvasId, {
    type: 'bar',
    data: {
      labels: renewableAdoptionData.map(d => d.type.length > 15 ? d.type.substring(0, 15) + '...' : d.type),
      datasets: [{
        label: 'Renewable Energy Adoption Rate (%)',
        data: renewableAdoptionData.map(d => d.adoptionRate),
        backgroundColor: renewableAdoptionData.map(d => 
          d.adoptionRate > 50 ? 'rgba(40, 167, 69, 0.8)' : 
          d.adoptionRate > 25 ? 'rgba(255, 193, 7, 0.8)' : 
          'rgba(220, 53, 69, 0.6)'
        ),
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          title: { display: true, text: 'Adoption Rate (%)' },
          beginAtZero: true,
          max: 100
        },
        y: {
          ticks: { font: { size: 10 } }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: function(context: any) {
              const index = context[0].dataIndex;
              const data = renewableAdoptionData[index];
              return [
                `Buildings with renewable: ${data.withRenewable}`,
                `Total buildings: ${data.total}`,
                `Adoption rate: ${data.adoptionRate.toFixed(1)}%`
              ];
            }
          }
        }
      }
    }
  });
  generateAndDisplayStory('Renewable Energy Adoption Analysis', 'Percentage of buildings with renewable energy systems by property type. Green bars indicate strong adoption (>50%), yellow shows moderate adoption (25-50%), and red shows low adoption (<25%).', renewableAdoptionStoryId);

  // 4. Top and Bottom Performers in Energy Efficiency
  const buildingsWithEfficiency = data
    .filter(d => d.siteEnergyUsedPerSqrFt > 0 && d.propertyGFA > 1000)
    .sort((a, b) => a.siteEnergyUsedPerSqrFt - b.siteEnergyUsedPerSqrFt);

  const topPerformers = buildingsWithEfficiency.slice(0, 10);
  const bottomPerformers = buildingsWithEfficiency.slice(-10).reverse();

  const { vizDiv: performersVizDiv, canvasId: performersCanvasId, storyContainerId: performersStoryId } = 
    createVisualizationContainer('efficiencyPerformers', 'Energy Efficiency Leaders vs Laggards');
  vizArea.appendChild(performersVizDiv);

  renderChart(performersCanvasId, {
    type: 'bar',
    data: {
      labels: [
        ...topPerformers.map(d => `${(d.propertyName || 'Unknown').substring(0, 20)}... (EFFICIENT)`),
        ...bottomPerformers.map(d => `${(d.propertyName || 'Unknown').substring(0, 20)}... (INEFFICIENT)`)
      ],
      datasets: [{
        label: 'Energy Use per Sq Ft (kBtu/sq ft)',
        data: [
          ...topPerformers.map(d => d.siteEnergyUsedPerSqrFt),
          ...bottomPerformers.map(d => d.siteEnergyUsedPerSqrFt)
        ],
        backgroundColor: [
          ...topPerformers.map(() => 'rgba(40, 167, 69, 0.7)'),
          ...bottomPerformers.map(() => 'rgba(220, 53, 69, 0.7)')
        ],
        borderColor: [
          ...topPerformers.map(() => 'rgba(40, 167, 69, 1)'),
          ...bottomPerformers.map(() => 'rgba(220, 53, 69, 1)')
        ],
        borderWidth: 1,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          title: { display: true, text: 'Energy Use per Sq Ft (kBtu/sq ft)' },
          beginAtZero: true
        },
        y: {
          ticks: { font: { size: 8 } }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: function(context: any) {
              const index = context[0].dataIndex;
              const building = index < 10 ? topPerformers[index] : bottomPerformers[index - 10];
              return [
                `Department: ${building.departmentName || 'N/A'}`,
                `Property Type: ${building.primaryPropertyType || 'N/A'}`,
                `GFA: ${building.propertyGFA.toLocaleString()} sq ft`,
                building.hasRenewable > 0 ? '✓ Has Renewable Energy' : '✗ No Renewable Energy'
              ];
            }
          }
        }
      }
    }
  });
  generateAndDisplayStory('Energy Efficiency Benchmarking', 'Comparison of the most and least energy-efficient buildings (minimum 1,000 sq ft). Green bars show the top 10 most efficient buildings, red bars show the 10 least efficient buildings.', performersStoryId);

  // 5. Efficiency Summary Matrix
  const efficiencyMatrix = data
    .filter(d => d.siteEnergyUsedPerSqrFt > 0 && d.waterUsedPerSqrFt > 0 && d.propertyGFA > 500)
    .map(d => {
      // Categorize efficiency levels
      const energyEfficiencyLevel = d.siteEnergyUsedPerSqrFt < 50 ? 'High' : 
                                   d.siteEnergyUsedPerSqrFt < 100 ? 'Medium' : 'Low';
      const waterEfficiencyLevel = d.waterUsedPerSqrFt < 10 ? 'High' : 
                                  d.waterUsedPerSqrFt < 25 ? 'Medium' : 'Low';
      return {
        building: d,
        energyLevel: energyEfficiencyLevel,
        waterLevel: waterEfficiencyLevel,
        category: `${energyEfficiencyLevel} Energy / ${waterEfficiencyLevel} Water`
      };
    });

  const matrixCounts = efficiencyMatrix.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const { vizDiv: matrixVizDiv, canvasId: matrixCanvasId, storyContainerId: matrixStoryId } = 
    createVisualizationContainer('efficiencyMatrix', 'Building Efficiency Classification Matrix');
  vizArea.appendChild(matrixVizDiv);

  const matrixLabels = Object.keys(matrixCounts);
  const matrixValues = Object.values(matrixCounts);

  renderChart(matrixCanvasId, {
    type: 'doughnut',
    data: {
      labels: matrixLabels,
      datasets: [{
        data: matrixValues,
        backgroundColor: [
          'rgba(40, 167, 69, 0.8)',   // High/High
          'rgba(255, 193, 7, 0.8)',   // High/Medium or Medium/High
          'rgba(255, 193, 7, 0.6)',   // Medium/Medium
          'rgba(255, 99, 132, 0.8)',  // Low efficiency combinations
          'rgba(255, 99, 132, 0.6)',
          'rgba(220, 53, 69, 0.8)',
          'rgba(220, 53, 69, 0.6)',
          'rgba(108, 117, 125, 0.6)',
          'rgba(108, 117, 125, 0.4)'
        ],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context: any) {
              const total = matrixValues.reduce((a, b) => a + b, 0);
              const percentage = ((context.parsed / total) * 100).toFixed(1);
              return `${context.label}: ${context.parsed} buildings (${percentage}%)`;
            }
          }
        },
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            usePointStyle: true,
            font: { size: 10 }
          }
        }
      }
    }
  });
  generateAndDisplayStory('Efficiency Classification', 'Buildings categorized by their energy and water efficiency levels. This matrix helps identify buildings that excel in both areas (green) versus those needing improvement (red).', matrixStoryId);

  // 6. Electrical Efficiency Analysis
  const electricalEfficiencyData = data
    .filter(d => d.elecUsedPerSqrFt > 0 && d.elecUsedPerSqrFt < 200 && d.propertyGFA > 500)
    .map(d => ({
      name: d.propertyName || "Unknown Property",
      department: d.departmentName || "Unknown Dept",
      type: d.primaryPropertyType || "Unknown Type",
      electricalIntensity: d.elecUsedPerSqrFt,
      hasRenewable: d.hasRenewable > 0,
      greenPowerPercent: d.percentGreenPower || 0,
      yearBuilt: d.yearBuilt,
      gfa: d.propertyGFA
    }))
    .sort((a, b) => a.electricalIntensity - b.electricalIntensity);

  // Get top and bottom electrical performers
  const topElectricalPerformers = electricalEfficiencyData.slice(0, 15);
  const bottomElectricalPerformers = electricalEfficiencyData.slice(-15).reverse();

  const { vizDiv: electricalVizDiv, canvasId: electricalCanvasId, storyContainerId: electricalStoryId } = 
    createVisualizationContainer('electricalEfficiency', 'Electrical Efficiency Analysis (kWh/sq ft)');
  vizArea.appendChild(electricalVizDiv);

  renderChart(electricalCanvasId, {
    type: 'bar',
    data: {
      labels: [
        ...topElectricalPerformers.map(d => `${d.name.substring(0, 15)}... (BEST)`),
        ...bottomElectricalPerformers.map(d => `${d.name.substring(0, 15)}... (WORST)`)
      ],
      datasets: [{
        label: 'Electrical Use per Sq Ft (kWh/sq ft)',
        data: [
          ...topElectricalPerformers.map(d => d.electricalIntensity),
          ...bottomElectricalPerformers.map(d => d.electricalIntensity)
        ],
        backgroundColor: [
          ...topElectricalPerformers.map(d => d.hasRenewable ? 'rgba(40, 167, 69, 0.8)' : 'rgba(40, 167, 69, 0.6)'),
          ...bottomElectricalPerformers.map(d => d.hasRenewable ? 'rgba(220, 53, 69, 0.8)' : 'rgba(220, 53, 69, 0.6)')
        ],
        borderColor: [
          ...topElectricalPerformers.map(d => d.hasRenewable ? 'rgba(40, 167, 69, 1)' : 'rgba(40, 167, 69, 0.8)'),
          ...bottomElectricalPerformers.map(d => d.hasRenewable ? 'rgba(220, 53, 69, 1)' : 'rgba(220, 53, 69, 0.8)')
        ],
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      scales: {
        x: {
          title: { display: true, text: 'Electrical Use per Sq Ft (kWh/sq ft)' },
          beginAtZero: true
        },
        y: {
          ticks: { font: { size: 8 } }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterBody: function(context: any) {
              const index = context[0].dataIndex;
              const building = index < 15 ? topElectricalPerformers[index] : bottomElectricalPerformers[index - 15];
              return [
                `Department: ${building.department}`,
                `Property Type: ${building.type}`,
                `GFA: ${building.gfa.toLocaleString()} sq ft`,
                `Green Power: ${building.greenPowerPercent.toFixed(1)}%`,
                `Year Built: ${building.yearBuilt || 'Unknown'}`,
                building.hasRenewable ? '✓ Has Renewable Energy' : '✗ No Renewable Energy'
              ];
            }
          }
        },
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { size: 11 }
          },
          title: {
            display: true,
            text: 'Darker shades indicate buildings with renewable energy'
          }
        }
      }
    }
  });
  generateAndDisplayStory('Electrical Efficiency Leaders and Laggards', 'Analysis of electrical consumption per square foot. The top 15 most efficient (green) and 15 least efficient (red) buildings are shown. Darker shades indicate buildings with renewable energy systems.', electricalStoryId);
}

// Enhanced filtering and data processing functions
function applyFilters(data: BuildingData[]): BuildingData[] {
  return data.filter(item => {
    // Department filter
    if (currentFilters.departments.length > 0 && 
        !currentFilters.departments.includes(item.departmentName)) {
      return false;
    }
    
    // Property type filter
    if (currentFilters.propertyTypes.length > 0 && 
        !currentFilters.propertyTypes.includes(item.primaryPropertyType)) {
      return false;
    }
    
    // Year range filter
    if (item.yearBuilt < currentFilters.yearRange[0] || 
        item.yearBuilt > currentFilters.yearRange[1]) {
      return false;
    }
    
    // Energy range filter
    if (item.siteEnergyUseKbtu < currentFilters.energyRange[0] || 
        item.siteEnergyUseKbtu > currentFilters.energyRange[1]) {
      return false;
    }
    
    // GFA range filter
    if (item.propertyGFA < currentFilters.gfaRange[0] || 
        item.propertyGFA > currentFilters.gfaRange[1]) {
      return false;
    }
    
    // LEED certification filter
    if (currentFilters.leedCertified) {
      const leedStatus = item.leedCertified ? item.leedCertified.trim().toLowerCase() : "";
      const isLeedCertified = leedStatus && leedStatus !== 'no' && leedStatus !== 'not applicable' && leedStatus !== '';
      if (currentFilters.leedCertified === 'certified' && !isLeedCertified) return false;
      if (currentFilters.leedCertified === 'not-certified' && isLeedCertified) return false;
    }
    
    // Search term filter
    if (currentFilters.searchTerm) {
      const searchLower = currentFilters.searchTerm.toLowerCase();
      const searchableText = `${item.propertyName} ${item.departmentName} ${item.address1} ${item.city}`.toLowerCase();
      if (!searchableText.includes(searchLower)) return false;
    }
    
    // City filter
    if (currentFilters.selectedCity && item.city !== currentFilters.selectedCity) {
      return false;
    }
    
    return true;
  });
}

function updateFilteredData(): void {
  filteredBuildingData = applyFilters(allBuildingData);
  
  // Close any open drill-down panels and modals when data updates
  const drillDownPanel = document.getElementById('drill-down-panel');
  if (drillDownPanel) {
    drillDownPanel.remove();
  }
  
  const modals = document.querySelectorAll('.modal-overlay');
  modals.forEach(modal => modal.remove());
  
  updateChartsWithFilteredData();
  updateFilterStatus();
}

function updateFilterStatus(): void {
  const statusElement = document.getElementById('filter-status');
  if (statusElement) {
    const total = allBuildingData.length;
    const filtered = filteredBuildingData.length;
    statusElement.textContent = `Showing ${filtered.toLocaleString()} of ${total.toLocaleString()} properties`;
    
    // Add filter chips
    const filtersContainer = document.getElementById('active-filters');
    if (filtersContainer) {
      filtersContainer.innerHTML = '';
      
      // Add active filter chips
      if (currentFilters.departments.length > 0) {
        addFilterChip(filtersContainer, 'departments', `Departments: ${currentFilters.departments.length} selected`);
      }
      if (currentFilters.propertyTypes.length > 0) {
        addFilterChip(filtersContainer, 'propertyTypes', `Types: ${currentFilters.propertyTypes.length} selected`);
      }
      if (currentFilters.searchTerm) {
        addFilterChip(filtersContainer, 'searchTerm', `Search: "${currentFilters.searchTerm}"`);
      }
      if (currentFilters.selectedCity) {
        addFilterChip(filtersContainer, 'selectedCity', `City: ${currentFilters.selectedCity}`);
      }
      if (currentFilters.leedCertified) {
        addFilterChip(filtersContainer, 'leedCertified', `LEED: ${currentFilters.leedCertified}`);
      }
    }
  }
}

function addFilterChip(container: HTMLElement, filterType: string, label: string): void {
  const chip = document.createElement('div');
  chip.className = 'filter-chip';
  chip.innerHTML = `
    <span>${label}</span>
    <button class="filter-chip-remove" data-filter="${filterType}">×</button>
  `;
  container.appendChild(chip);
}

function clearFilter(filterType: string): void {
  switch (filterType) {
    case 'departments':
      currentFilters.departments = [];
      break;
    case 'propertyTypes':
      currentFilters.propertyTypes = [];
      break;
    case 'searchTerm':
      currentFilters.searchTerm = '';
      const searchInput = document.getElementById('search-input') as HTMLInputElement;
      if (searchInput) searchInput.value = '';
      break;
    case 'selectedCity':
      currentFilters.selectedCity = null;
      break;
    case 'leedCertified':
      currentFilters.leedCertified = null;
      break;
  }
  updateFilteredData();
}

function resetAllFilters(): void {
  currentFilters = {
    departments: [],
    propertyTypes: [],
    yearRange: [1900, 2025],
    energyRange: [0, Infinity],
    gfaRange: [0, Infinity],
    leedCertified: null,
    searchTerm: '',
    selectedCity: null
  };
  
  // Reset UI elements
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  if (searchInput) searchInput.value = '';
  
  const checkboxes = document.querySelectorAll('.filter-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(cb => cb.checked = false);
  
  updateFilteredData();
}

function exportFilteredData(format: 'csv' | 'json'): void {
  const data = filteredBuildingData;
  let content: string;
  let filename: string;
  let mimeType: string;
  
  if (format === 'csv') {
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(item => 
      Object.values(item).map(val => 
        typeof val === 'string' && val.includes(',') ? `"${val}"` : val
      ).join(',')
    );
    content = [headers, ...rows].join('\n');
    filename = 'california_buildings_filtered.csv';
    mimeType = 'text/csv';
  } else {
    content = JSON.stringify(data, null, 2);
    filename = 'california_buildings_filtered.json';
    mimeType = 'application/json';
  }
  
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function initializeApp() {
  try {
    console.log("Starting application initialization...");
    
    // Initialize AI with graceful fallback
    if (API_KEY) {
      try {
        ai = new GoogleGenAI({ apiKey: API_KEY });
        console.log("Gemini AI initialized successfully");
      } catch (aiError) {
        console.warn("Failed to initialize Gemini AI, story generation will be disabled:", aiError);
        ai = null;
      }
    } else {
      console.log("No API key provided, story generation will be disabled");
    }
    
    console.log("Fetching and parsing building data...");
    allBuildingData = await fetchDataAndParse();
    
    if (allBuildingData.length === 0) {
      throw new Error("No building data was loaded");
    }
    
    filteredBuildingData = [...allBuildingData]; // Initialize filtered data
    console.log(`Loaded ${allBuildingData.length} building records.`);
    console.log('filteredBuildingData', filteredBuildingData);
  //   fetch('data_with_coords.json')
  // .then(res => res.json())
  // .then(data => {
  //   console.log('First 3 buildings:', data.slice(0,3));
  //   renderCaliforniaCityEnergyMap(filteredBuildingData, 'total');

  // });




    
    // Initialize UI components with error handling
    try {
      console.log("Initializing filters...");
      initializeFilters();
    } catch (filterError) {
      console.error("Error initializing filters:", filterError);
      // Continue without filters
    }
    
    try {
      console.log("Initializing event handlers...");
      initializeEventHandlers();
    } catch (handlerError) {
      console.error("Error initializing event handlers:", handlerError);
      // Continue without some handlers
    }
    
    try {
      console.log("Updating UI components...");
      updateQuickStats();
      updateFilterStatus();
    } catch (uiError) {
      console.error("Error updating UI components:", uiError);
      // Continue anyway
    }
    
    // Set up navigation
    try {
      setupNavigation();
    } catch (navError) {
      console.error("Error setting up navigation:", navError);
      // Continue anyway
    }
    
    // Default to overview
    console.log("Rendering initial visualization...");
    displayVisualization('overview');
    
    console.log("Application initialized successfully!");
    
  } catch (error) {
    console.error("Failed to initialize app:", error);
    const vizContent = document.getElementById('visualization-content');
    let errorMessage = "Unknown error";
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    } 
    if (vizContent) {
      vizContent.innerHTML = `
        <div class="error-message">
          <h3>Failed to load the application</h3>
          <p>Error: ${errorMessage}</p>
          <p>Please check the console for more details and ensure:</p>
          <ul>
            <li>The 'data.json' file exists in the project root</li>
            <li>The JSON file is properly formatted</li>
            <li>All required dependencies are installed</li>
          </ul>
          <button onclick="location.reload()" class="btn-primary">Refresh Page</button>
        </div>
      `;
    }
  }
  
}

function initializeFilters(): void {
  // Populate department filter
  const departments = [...new Set(allBuildingData.map(b => b.departmentName).filter(d => d))].sort();
  const deptCheckboxes = document.getElementById('dept-checkboxes')!;
  deptCheckboxes.innerHTML = departments.map(dept => `
    <label>
      <input type="checkbox" class="filter-checkbox" value="${dept}" data-filter="departments">
      ${dept}
    </label>
  `).join('');
  
  // Populate property type filter
  const propertyTypes = [...new Set(allBuildingData.map(b => b.primaryPropertyType).filter(t => t))].sort();
  const typeCheckboxes = document.getElementById('type-checkboxes')!;
  typeCheckboxes.innerHTML = propertyTypes.map(type => `
    <label>
      <input type="checkbox" class="filter-checkbox" value="${type}" data-filter="propertyTypes">
      ${type}
    </label>
  `).join('');
  
  // Populate city filter
  const cities = [...new Set(allBuildingData.map(b => b.city).filter(c => c))].sort();
  const citySelect = document.getElementById('city-filter') as HTMLSelectElement;
  citySelect.innerHTML = '<option value="">All Cities</option>' + cities.map(city => `
    <option value="${city}">${city}</option>
  `).join('');
  
  // Set default year range
  const years = allBuildingData.map(b => b.yearBuilt).filter(y => y > 1800 && y < 2030);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  
  (document.getElementById('year-min') as HTMLInputElement).value = minYear.toString();
  (document.getElementById('year-max') as HTMLInputElement).value = maxYear.toString();
  
  currentFilters.yearRange = [minYear, maxYear];
}

function initializeEventHandlers(): void {
  // Header controls
  document.getElementById('toggle-filters')?.addEventListener('click', toggleFiltersPanel);
  document.getElementById('toggle-comparison')?.addEventListener('click', toggleComparisonPanel);
  document.getElementById('export-data')?.addEventListener('click', showExportModal);
  
  // Filter panel controls
  document.getElementById('close-filters')?.addEventListener('click', () => {
    document.getElementById('filters-panel')?.classList.add('collapsed');
  });
  
  document.getElementById('apply-filters')?.addEventListener('click', applyFiltersFromUI);
  document.getElementById('reset-filters')?.addEventListener('click', () => {
    (window as any).resetAllFilters();
  });
  
  // Search input
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  let searchTimeout: NodeJS.Timeout;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentFilters.searchTerm = (e.target as HTMLInputElement).value;
      updateFilteredData();
    }, 300);
  });
  
  // Range inputs
  document.getElementById('year-min')?.addEventListener('change', updateYearRange);
  document.getElementById('year-max')?.addEventListener('change', updateYearRange);
  document.getElementById('energy-min')?.addEventListener('change', updateEnergyRange);
  document.getElementById('energy-max')?.addEventListener('change', updateEnergyRange);
  document.getElementById('gfa-min')?.addEventListener('change', updateGFARange);
  document.getElementById('gfa-max')?.addEventListener('change', updateGFARange);
  
  // Select filters
  document.getElementById('leed-filter')?.addEventListener('change', (e) => {
    currentFilters.leedCertified = (e.target as HTMLSelectElement).value || null;
    updateFilteredData();
  });
  
  document.getElementById('city-filter')?.addEventListener('change', (e) => {
    currentFilters.selectedCity = (e.target as HTMLSelectElement).value || null;
    updateFilteredData();
  });

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('button');
  if (!target) return;

  const chartId = target.getAttribute('data-chart');
  if (!chartId) return;

  const chart = activeCharts.find(c => c.canvas.id === chartId);
  if (!chart) return;

  if (target.classList.contains('btn-zoom-in')) {
    (chart as any).zoom(1.2);
  } else if (target.classList.contains('btn-zoom-out')) {
    (chart as any).zoom(0.8);
  } else if (target.classList.contains('btn-zoom-reset')) {
    (chart as any).resetZoom();
  }
});

  
  // Checkbox filters
  document.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('filter-checkbox')) {
      const filterType = target.dataset.filter as keyof FilterState;
      const value = target.value;
      
      if (filterType === 'departments' || filterType === 'propertyTypes') {
        const currentArray = currentFilters[filterType] as string[];
        if (target.checked) {
          if (!currentArray.includes(value)) {
            currentArray.push(value);
          }
        } else {
          const index = currentArray.indexOf(value);
          if (index > -1) {
            currentArray.splice(index, 1);
          }
        }
        updateFilteredData();
      }
    }
  });
  
  // Filter chip removal
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('filter-chip-remove')) {
      const filterType = target.dataset.filter!;
      clearFilter(filterType);
    }
  });
  
  // Expand/collapse filter sections
  document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  // Try to find the closest .expand-btn (including the target itself)
  const btn = target.classList.contains('expand-btn') 
    ? target 
    : target.closest('.expand-btn');

    if (btn && btn instanceof HTMLElement && btn.dataset.target) {
      const targetId = btn.dataset.target;
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        btn.classList.toggle('expanded');
        targetElement.classList.toggle('collapsed');
      }
    }
  });

  
  // Visualization controls
  document.getElementById('fullscreen-btn')?.addEventListener('click', toggleFullscreen);
  document.getElementById('zoom-reset')?.addEventListener('click', resetZoom);
  document.getElementById('screenshot-btn')?.addEventListener('click', takeScreenshot);
  document.getElementById('show-animations')?.addEventListener('change', toggleAnimations);
  document.getElementById('dark-mode')?.addEventListener('change', toggleDarkMode);
  
  // Modal controls
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal-close')) {
      target.closest('.modal-overlay')?.remove();
    }
  });
  
  // Export modal
  document.getElementById('confirm-export')?.addEventListener('click', handleExport);
  
  // Comparison panel
  document.getElementById('close-comparison')?.addEventListener('click', () => {
    document.getElementById('comparison-panel')?.classList.add('collapsed');
  });
  
  // Comparison panel buttons
  document.getElementById('compare-buildings')?.addEventListener('click', () => {
    (window as any).compareSelectedBuildings();
  });
  
  document.getElementById('clear-comparison')?.addEventListener('click', () => {
    (window as any).clearAllComparison();
  });
  
  // Add universal reset button in header
  const headerControls = document.querySelector('.header-controls');
  if (headerControls && !document.getElementById('universal-reset')) {
    const resetButton = document.createElement('button');
    resetButton.id = 'universal-reset';
    resetButton.className = 'btn-secondary';
    resetButton.innerHTML = '<i class="fas fa-undo"></i> Reset All';
    resetButton.title = 'Reset all filters and selections';
    resetButton.addEventListener('click', () => {
      (window as any).resetAllFilters();
      (window as any).clearAllComparison();
      chartInteractionState.comparisonMode = false;
      document.getElementById('comparison-panel')?.classList.add('collapsed');
    });
    headerControls.appendChild(resetButton);
  }
}

function setupNavigation(): void {
  document.querySelectorAll('.nav-button').forEach(button => {
    button.addEventListener('click', (e) => {
      const view = (e.target as HTMLElement).getAttribute('data-view')!;
      displayVisualization(view);
    });
  });
}

function updateQuickStats(): void {
  const totalProperties = document.getElementById('total-properties')!;
  const avgEnergy = document.getElementById('avg-energy')!;
  const greenBuildings = document.getElementById('green-buildings')!;
  
  const data = filteredBuildingData;
  
  // Calculate average energy with proper validation
  const validEnergyBuildings = data.filter(b => b.siteEnergyUseKbtu > 0 && isFinite(b.siteEnergyUseKbtu));
  const avgEnergyUse = validEnergyBuildings.length > 0 
    ? validEnergyBuildings.reduce((sum, b) => sum + b.siteEnergyUseKbtu, 0) / validEnergyBuildings.length 
    : 0;
  
  // Count green buildings with proper validation
  const greenBuildingsCount = data.filter(b => {
    const hasGreenPower = b.percentGreenPower > 0 && isFinite(b.percentGreenPower);
    const isLeedCertified = b.leedCertified && 
      b.leedCertified.toLowerCase() !== 'no' && 
      b.leedCertified.toLowerCase() !== 'not applicable' &&
      b.leedCertified.toLowerCase() !== '';
    return hasGreenPower || isLeedCertified;
  }).length;
  
  // Format numbers safely
  const formatNumber = (num: number): string => {
    if (isNaN(num) || !isFinite(num) || num === 0) return '0';
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };
  
  totalProperties.textContent = data.length.toLocaleString();
  avgEnergy.textContent = formatNumber(avgEnergyUse) + ' kBtu';
  greenBuildings.textContent = greenBuildingsCount.toLocaleString();
}

// UI Event Handlers
function toggleFiltersPanel(): void {
  const panel = document.getElementById('filters-panel')!;
  panel.classList.toggle('collapsed');
}

function toggleComparisonPanel(): void {
  const panel = document.getElementById('comparison-panel')!;
  panel.classList.toggle('collapsed');
}

function showExportModal(): void {
  document.getElementById('export-modal')!.style.display = 'flex';
}

function applyFiltersFromUI(): void {
  updateFilteredData();
}

function updateYearRange(): void {
  const minEl = document.getElementById('year-min') as HTMLInputElement;
  const maxEl = document.getElementById('year-max') as HTMLInputElement;
  
  const min = parseInt(minEl.value) || 1800;
  const max = parseInt(maxEl.value) || 2025;
  
  currentFilters.yearRange = [min, max];
  updateFilteredData();
}

function updateEnergyRange(): void {
  const minEl = document.getElementById('energy-min') as HTMLInputElement;
  const maxEl = document.getElementById('energy-max') as HTMLInputElement;
  
  const min = parseFloat(minEl.value) || 0;
  const max = parseFloat(maxEl.value) || Infinity;
  
  currentFilters.energyRange = [min, max];
  updateFilteredData();
}

function updateGFARange(): void {
  const minEl = document.getElementById('gfa-min') as HTMLInputElement;
  const maxEl = document.getElementById('gfa-max') as HTMLInputElement;
  
  const min = parseFloat(minEl.value) || 0;
  const max = parseFloat(maxEl.value) || Infinity;
  
  currentFilters.gfaRange = [min, max];
  updateFilteredData();
}

function toggleFullscreen(): void {
  const vizArea = document.getElementById('visualization-area')!;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    vizArea.requestFullscreen();
  }
}

function resetZoom(): void {
  let zoomResetCount = 0;
  activeCharts.forEach(chart => {
    if ((chart as any).resetZoom) {
      (chart as any).resetZoom('none'); // Use 'none' for instant reset without animation
      zoomResetCount++;
    }
  });
  
  // Provide user feedback
  if (zoomResetCount > 0) {
    const feedback = document.createElement('div');
    feedback.className = 'zoom-feedback';
    feedback.textContent = `Zoom reset for ${zoomResetCount} chart(s)`;
    feedback.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #28a745;
      color: white;
      padding: 10px 15px;
      border-radius: 4px;
      z-index: 10000;
      font-size: 14px;
    `;
    document.body.appendChild(feedback);
    
    setTimeout(() => {
      feedback.remove();
    }, 2000);
  }
}

function takeScreenshot(): void {
  // Get the visualization content area
  const vizContent = document.getElementById('visualization-content');
  if (!vizContent) {
    showNotification('No visualization content to capture', 'error');
    return;
  }
  
  // Create a simple implementation without external libraries
  showNotification('Screenshot functionality requires html2canvas library. Showing alternative download option.', 'info');
  
  // Alternative: Export current view data as JSON for analysis
  const currentData = {
    view: chartInteractionState.currentView,
    filters: currentFilters,
    totalBuildings: allBuildingData.length,
    filteredBuildings: filteredBuildingData.length,
    selectedForComparison: chartInteractionState.selectedItems.length,
    timestamp: new Date().toISOString()
  };
  
  const blob = new Blob([JSON.stringify(currentData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashboard_state_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showNotification('Dashboard state exported as JSON', 'success');
}

function toggleAnimations(e: Event): void {
  const enabled = (e.target as HTMLInputElement).checked;
  document.documentElement.style.setProperty('--animation-duration', enabled ? '0.3s' : '0s');
  document.documentElement.style.setProperty('--transition-duration', enabled ? '0.3s' : '0s');
  
  // Apply to body and main containers
  const elements = document.querySelectorAll('.visualization-container, .modal-overlay, .drill-down-panel, .notification');
  elements.forEach(el => {
    (el as HTMLElement).style.transition = enabled ? 'all 0.3s ease' : 'none';
  });
  
  // Update chart animations
  activeCharts.forEach(chart => {
    if (chart && chart.options && chart.options.animation) {
      chart.options.animation.duration = enabled ? 750 : 0;
      chart.update('none'); // Update without animation to apply the setting
    }
  });
  
  showNotification(`Animations ${enabled ? 'enabled' : 'disabled'}`, 'info');
}

function toggleDarkMode(e: Event): void {
  const enabled = (e.target as HTMLInputElement).checked;
  document.body.classList.toggle('dark-mode', enabled);
}

function handleExport(): void {
  const formatRadio = document.querySelector('input[name="export-format"]:checked') as HTMLInputElement;
  const scopeRadio = document.querySelector('input[name="export-scope"]:checked') as HTMLInputElement;
  
  const format = formatRadio.value as 'csv' | 'json';
  const useFiltered = scopeRadio.value === 'filtered';
  
  if (useFiltered) {
    exportFilteredData(format);
  } else {
    // Export all data
    const data = allBuildingData;
    let content: string;
    let filename: string;
    let mimeType: string;
    
    if (format === 'csv') {
      const headers = Object.keys(data[0]).join(',');
      const rows = data.map(item => 
        Object.values(item).map(val => 
          typeof val === 'string' && val.includes(',') ? `"${val}"` : val
        ).join(',')
      );
      content = [headers, ...rows].join('\n');
      filename = 'california_buildings_all.csv';
      mimeType = 'text/csv';
    } else {
      content = JSON.stringify(data, null, 2);
      filename = 'california_buildings_all.json';
      mimeType = 'application/json';
    }
    
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  document.getElementById('export-modal')!.style.display = 'none';
}

// Global functions for onclick handlers
(window as any).resetDepartmentFilter = () => {
  currentFilters.departments = [];
  updateFilteredData();
};

(window as any).resetPropertyTypeFilter = () => {
  currentFilters.propertyTypes = [];
  updateFilteredData();
};

(window as any).toggleComparisonMode = () => {
  chartInteractionState.comparisonMode = !chartInteractionState.comparisonMode;
  const panel = document.getElementById('comparison-panel');
  if (panel) {
    if (chartInteractionState.comparisonMode) {
      panel.classList.remove('collapsed');
      showNotification('Comparison mode enabled. Click on buildings to add them to comparison.', 'info');
    } else {
      panel.classList.add('collapsed');
      showNotification('Comparison mode disabled.', 'info');
    }
  }
  console.log('Comparison mode:', chartInteractionState.comparisonMode);
};

(window as any).exportChartData = (type: string) => {
  let dataToExport: any[] = [];
  let filename = '';
  
  switch (type) {
    case 'departments':
      const deptCounts = filteredBuildingData.reduce((acc, item) => {
        const deptName = item.departmentName || "Unknown Department";
        acc[deptName] = (acc[deptName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      dataToExport = Object.entries(deptCounts).map(([dept, count]) => ({
        Department: dept,
        PropertyCount: count
      }));
      filename = 'department_distribution.csv';
      break;
    case 'propertyTypes':
      const typeCounts = filteredBuildingData.reduce((acc, item) => {
        const typeName = item.primaryPropertyType || "Unknown Type";
        acc[typeName] = (acc[typeName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      dataToExport = Object.entries(typeCounts).map(([type, count]) => ({
        PropertyType: type,
        PropertyCount: count
      }));
      filename = 'property_type_distribution.csv';
      break;
    default:
      dataToExport = filteredBuildingData;
      filename = 'filtered_buildings.csv';
  }
  
  // Export as CSV
  const headers = Object.keys(dataToExport[0] || {}).join(',');
  const rows = dataToExport.map(item => 
    Object.values(item).map(val => 
      typeof val === 'string' && val.includes(',') ? `"${val}"` : val
    ).join(',')
  );
  const content = [headers, ...rows].join('\n');
  
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showNotification(`Exported ${dataToExport.length} records to ${filename}`, 'success');
};

(window as any).showPropertyTypeBreakdown = () => {
  const typeCounts = filteredBuildingData.reduce((acc, item) => {
    const typeName = item.primaryPropertyType || "Unknown Type";
    acc[typeName] = (acc[typeName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const sortedTypes = Object.entries(typeCounts).sort(([,a],[,b]) => b-a);
  const total = filteredBuildingData.length;
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Detailed Property Type Breakdown</h3>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div class="breakdown-table">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                <th style="padding: 0.75rem; text-align: left;">Property Type</th>
                <th style="padding: 0.75rem; text-align: right;">Count</th>
                <th style="padding: 0.75rem; text-align: right;">Percentage</th>
                <th style="padding: 0.75rem; text-align: center;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${sortedTypes.map(([type, count]) => {
                const percentage = ((count / total) * 100).toFixed(1);
                return `
                  <tr style="border-bottom: 1px solid #e9ecef;">
                    <td style="padding: 0.75rem;">${type}</td>
                    <td style="padding: 0.75rem; text-align: right;">${count.toLocaleString()}</td>
                    <td style="padding: 0.75rem; text-align: right;">${percentage}%</td>
                    <td style="padding: 0.75rem; text-align: center;">
                      <button class="btn-sm" onclick="filterToPropertyType('${type}'); this.closest('.modal-overlay').remove();">
                        Filter
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.modal-close')?.addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
};

(window as any).filterToCategory = (label: string, chartId: string) => {
  console.log('Filtering to category:', label, 'from chart:', chartId);
  
  // Clear existing filters first for the specific category
  if (chartId.includes('dept') || chartId.includes('Department')) {
    currentFilters.departments = [label];
    showNotification(`Filtered to department: ${label}`, 'success');
  } else if (chartId.includes('type') || chartId.includes('propertyTypes')) {
    currentFilters.propertyTypes = [label];
    showNotification(`Filtered to property type: ${label}`, 'success');
  } else if (chartId.includes('city') || chartId.includes('cityDistribution')) {
    currentFilters.selectedCity = label;
    showNotification(`Filtered to city: ${label}`, 'success');
  } else if (chartId.includes('buildingAge')) {
    // Handle building age category filtering
    switch (label) {
      case 'Pre-1900':
        currentFilters.yearRange = [1800, 1899];
        break;
      case '1900-1919':
        currentFilters.yearRange = [1900, 1919];
        break;
      case '1920-1939':
        currentFilters.yearRange = [1920, 1939];
        break;
      case '1940-1959':
        currentFilters.yearRange = [1940, 1959];
        break;
      case '1960-1979':
        currentFilters.yearRange = [1960, 1979];
        break;
      case '1980-1999':
        currentFilters.yearRange = [1980, 1999];
        break;
      case '2000-Present':
        currentFilters.yearRange = [2000, 2025];
        break;
      case 'Unknown/Pre-1899':
        currentFilters.yearRange = [0, 1899];
        break;
    }
    showNotification(`Filtered to building age: ${label}`, 'success');
  } else if (chartId.includes('greenPower')) {
    // Handle green power category filtering
    switch (label) {
      case '0% Usage':
        currentFilters.energyRange = [0, 0];
        break;
      case '1-25%':
        // This would need custom filtering logic for green power percentage
        showNotification(`Green power filtering for ${label} not yet implemented`, 'warning');
        break;
      // Add more green power cases as needed
    }
  }
  
  updateFilteredData();
  document.getElementById('drill-down-panel')?.remove();
};

(window as any).filterToPropertyType = (propertyType: string) => {
  currentFilters.propertyTypes = [propertyType];
  updateFilteredData();
  showNotification(`Filtered to property type: ${propertyType}`, 'success');
};

(window as any).compareWithOthers = (label: string, chartId: string) => {
  chartInteractionState.comparisonMode = true;
  const panel = document.getElementById('comparison-panel');
  if (panel) {
    panel.classList.remove('collapsed');
  }
  showNotification(`Comparison mode enabled for ${label}`, 'info');
  console.log('Comparing', label, 'with others');
  document.getElementById('drill-down-panel')?.remove();
};

// Add utility function for notifications
function showNotification(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info'): void {
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : type === 'warning' ? '#ffc107' : '#007bff'};
    color: ${type === 'warning' ? '#212529' : '#fff'};
    padding: 12px 16px;
    border-radius: 6px;
    z-index: 10000;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    max-width: 300px;
    word-wrap: break-word;
    animation: slideInFromRight 0.3s ease-out;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOutToRight 0.3s ease-in forwards';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 300);
  }, 3000);
}

// Update the main function calls to use filtered data
function updateChartsWithFilteredData(): void {
  updateQuickStats();
  const currentView = chartInteractionState.currentView;
  displayVisualization(currentView, filteredBuildingData);
}

// Initialize the application
document.addEventListener('DOMContentLoaded', initializeApp);

(window as any).showBuildingDetailsModal = showBuildingDetailsModal;

(window as any).showBuildingsList = (label: string, chartId: string) => {
  const buildings = getRelatedBuildings(label, chartId);
  
  // Helper function to format values safely
  const formatValue = (value: any, suffix: string = ''): string => {
    if (value === null || value === undefined || 
        (typeof value === 'number' && (isNaN(value) || !isFinite(value)))) {
      return 'N/A';
    }
    if (typeof value === 'number') {
      return value === 0 ? '0' + suffix : value.toLocaleString() + suffix;
    }
    return String(value);
  };
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Buildings in ${label || 'Unknown Category'} (${buildings.length} total)</h3>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div class="buildings-list">
          ${buildings.slice(0, 50).map((b, index) => `
            <div class="building-list-item" onclick="showBuildingDetailsModal(${JSON.stringify(b).replace(/"/g, '&quot;')})">
              <strong>${b.propertyName || 'Unknown Property'}</strong><br>
              <small>${b.address1 || 'N/A'}, ${b.city || 'N/A'}</small><br>
              <small>Energy: ${formatValue(b.siteEnergyUseKbtu, ' kBtu')} | GFA: ${formatValue(b.propertyGFA, ' sq ft')}</small>
            </div>
          `).join('')}
          ${buildings.length > 50 ? `<p><em>Showing first 50 of ${buildings.length} buildings. Use filters to narrow results.</em></p>` : ''}
          ${buildings.length === 0 ? `<p><em>No buildings found for this category</em></p>` : ''}
        </div>
        <div class="modal-actions" style="margin-top: 1rem; text-align: center;">
          <button class="btn-primary" onclick="filterToCategory('${label}', '${chartId}'); this.closest('.modal-overlay').remove();">
            Filter to This Category
          </button>
          <button class="btn-secondary" onclick="exportBuildingsList('${label}', '${chartId}'); this.closest('.modal-overlay').remove();">
            Export List
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add click event for building items
  modal.querySelectorAll('.building-list-item').forEach((item, index) => {
    item.addEventListener('click', () => {
      showBuildingDetailsModal(buildings[index]);
    });
  });
  
  modal.querySelector('.modal-close')?.addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  document.getElementById('drill-down-panel')?.remove();
};

(window as any).addToComparison = (propertyId: string) => {
  const building = allBuildingData.find(b => b.propertyId === propertyId);
  if (building) {
    // Check if already in comparison
    const existingIndex = chartInteractionState.selectedItems.findIndex(item => item.propertyId === propertyId);
    if (existingIndex === -1) {
      chartInteractionState.selectedItems.push(building);
      updateComparisonPanel();
      showNotification(`Added "${building.propertyName}" to comparison`, 'success');
    } else {
      showNotification(`"${building.propertyName}" is already in comparison`, 'warning');
    }
  }
};

(window as any).filterSimilarBuildings = (propertyType: string) => {
  currentFilters.propertyTypes = [propertyType];
  updateFilteredData();
  showNotification(`Showing similar buildings of type: ${propertyType}`, 'success');
};

(window as any).exportBuildingsList = (label: string, chartId: string) => {
  const buildings = getRelatedBuildings(label, chartId);
  if (buildings.length === 0) {
    showNotification('No buildings to export', 'warning');
    return;
  }
  
  // Export as CSV
  const headers = Object.keys(buildings[0]).join(',');
  const rows = buildings.map(item => 
    Object.values(item).map(val => 
      typeof val === 'string' && val.includes(',') ? `"${val}"` : val
    ).join(',')
  );
  const content = [headers, ...rows].join('\n');
  
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `buildings_${label.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showNotification(`Exported ${buildings.length} buildings for ${label}`, 'success');
};

(window as any).removeFromComparison = (propertyId: string) => {
  const index = chartInteractionState.selectedItems.findIndex(item => item.propertyId === propertyId);
  if (index !== -1) {
    const removed = chartInteractionState.selectedItems.splice(index, 1)[0];
    updateComparisonPanel();
    showNotification(`Removed "${removed.propertyName}" from comparison`, 'info');
  }
};

(window as any).clearAllComparison = () => {
  chartInteractionState.selectedItems = [];
  updateComparisonPanel();
  showNotification('Cleared all comparison items', 'info');
};

(window as any).compareSelectedBuildings = () => {
  if (chartInteractionState.selectedItems.length < 2) {
    showNotification('Please select at least 2 buildings to compare', 'warning');
    return;
  }
  
  showBuildingComparisonModal(chartInteractionState.selectedItems);
};

// Universal reset function
(window as any).resetAllFilters = () => {
  currentFilters = {
    departments: [],
    propertyTypes: [],
    yearRange: [1900, 2025],
    energyRange: [0, Infinity],
    gfaRange: [0, Infinity],
    leedCertified: null,
    searchTerm: '',
    selectedCity: null
  };
  
  // Reset UI elements
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  if (searchInput) searchInput.value = '';
  
  const checkboxes = document.querySelectorAll('.filter-checkbox') as NodeListOf<HTMLInputElement>;
  checkboxes.forEach(cb => cb.checked = false);
  
  const selects = document.querySelectorAll('select') as NodeListOf<HTMLSelectElement>;
  selects.forEach(select => {
    if (select.id === 'leed-filter' || select.id === 'city-filter') {
      select.value = '';
    }
  });
  
  // Reset year range inputs if they exist
  const yearInputs = allBuildingData.length > 0 ? allBuildingData.map(b => b.yearBuilt).filter(y => y > 1800 && y < 2030) : [];
  if (yearInputs.length > 0) {
    const minYear = Math.min(...yearInputs);
    const maxYear = Math.max(...yearInputs);
    
    const yearMinInput = document.getElementById('year-min') as HTMLInputElement;
    const yearMaxInput = document.getElementById('year-max') as HTMLInputElement;
    if (yearMinInput) yearMinInput.value = minYear.toString();
    if (yearMaxInput) yearMaxInput.value = maxYear.toString();
    
    currentFilters.yearRange = [minYear, maxYear];
  }
  
  updateFilteredData();
  showNotification('All filters have been reset', 'success');
};

function updateComparisonPanel(): void {
  const comparisonContent = document.getElementById('comparison-items');
  if (!comparisonContent) return;
  
  if (chartInteractionState.selectedItems.length === 0) {
    comparisonContent.innerHTML = '<p style="text-align: center; color: #6c757d; margin: 2rem 0;">No buildings selected for comparison</p>';
    return;
  }
  
  const formatValue = (value: any, suffix: string = ''): string => {
    if (value === null || value === undefined || 
        (typeof value === 'number' && (isNaN(value) || !isFinite(value)))) {
      return 'N/A';
    }
    if (typeof value === 'number') {
      return value === 0 ? '0' + suffix : value.toLocaleString() + suffix;
    }
    return String(value);
  };
  
  comparisonContent.innerHTML = chartInteractionState.selectedItems.map((building, index) => `
    <div class="comparison-item" style="border: 1px solid #dee2e6; border-radius: 6px; padding: 1rem; margin-bottom: 1rem;">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
        <strong style="color: #007bff; font-size: 0.9rem;">${building.propertyName || 'Unknown Property'}</strong>
        <button onclick="removeFromComparison('${building.propertyId}')" style="background: #dc3545; color: white; border: none; border-radius: 3px; padding: 2px 6px; font-size: 0.8rem; cursor: pointer;">×</button>
      </div>
      <div style="font-size: 0.8rem; color: #6c757d; margin-bottom: 0.5rem;">
        ${building.address1 || 'N/A'}, ${building.city || 'N/A'}<br>
        ${building.departmentName || 'N/A'} | ${building.primaryPropertyType || 'N/A'}
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.75rem;">
        <div><strong>GFA:</strong> ${formatValue(building.propertyGFA, ' sq ft')}</div>
        <div><strong>Energy:</strong> ${formatValue(building.siteEnergyUseKbtu, ' kBtu')}</div>
        <div><strong>Year Built:</strong> ${formatValue(building.yearBuilt)}</div>
        <div><strong>Green Power:</strong> ${formatValue(building.percentGreenPower, '%')}</div>
      </div>
    </div>
  `).join('');
}

function showBuildingComparisonModal(buildings: BuildingData[]): void {
  const formatValue = (value: any, suffix: string = ''): string => {
    if (value === null || value === undefined || 
        (typeof value === 'number' && (isNaN(value) || !isFinite(value)))) {
      return 'N/A';
    }
    if (typeof value === 'number') {
      return value === 0 ? '0' + suffix : value.toLocaleString() + suffix;
    }
    return String(value);
  };
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 90vw; width: 800px;">
      <div class="modal-header">
        <h3>Building Comparison (${buildings.length} buildings)</h3>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
            <thead>
              <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                <th style="padding: 0.75rem; text-align: left; border-right: 1px solid #dee2e6;">Property</th>
                ${buildings.map((_, i) => `<th style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">Building ${i + 1}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">Name</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${b.propertyName || 'N/A'}</td>`).join('')}
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">Department</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${b.departmentName || 'N/A'}</td>`).join('')}
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">Property Type</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${b.primaryPropertyType || 'N/A'}</td>`).join('')}
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">GFA (sq ft)</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${formatValue(b.propertyGFA)}</td>`).join('')}
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">Energy Use (kBtu)</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${formatValue(b.siteEnergyUseKbtu)}</td>`).join('')}
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">Year Built</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${formatValue(b.yearBuilt)}</td>`).join('')}
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">Green Power (%)</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${formatValue(b.percentGreenPower)}</td>`).join('')}
              </tr>
              <tr style="border-bottom: 1px solid #e9ecef;">
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">Water Use (kgal)</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${formatValue(b.waterUseKgal)}</td>`).join('')}
              </tr>
              <tr>
                <td style="padding: 0.75rem; font-weight: 600; border-right: 1px solid #dee2e6;">LEED Certified</td>
                ${buildings.map(b => `<td style="padding: 0.75rem; text-align: center; border-right: 1px solid #dee2e6;">${b.leedCertified || 'No'}</td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.modal-close')?.addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}
