import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FormData, CINEMATIC_EASE, VEHICLE_TYPES } from '../../types';
import { ActionButton } from '../UI/Controls';
import { ArrowLeft, ExternalLink, Info, Star, Plus, X, Layers, Check, ShieldCheck } from 'lucide-react';
import { playSound } from '../../lib/sounds';

const CANADIAN_INVENTORY: Record<string, Record<string, any[]>> = {
  'Car': {
    'Sedan': [
      { name: 'Honda Civic', year: 2024, rating: 4.8, features: ['Honda Sensing®', 'Heated Front Seats', 'Available Hatchback'] },
      { name: 'Honda Accord', year: 2024, rating: 4.7, features: ['Hybrid Powertrain', '12.3-inch Touchscreen', 'Google Built-in'] },
      { name: 'Toyota Corolla', year: 2024, rating: 4.9, features: ['AWD Hybrid available', 'Toyota Safety Sense 3.0', 'Reliability King'] },
      { name: 'Toyota Camry', year: 2024, rating: 4.8, features: ['V6 available', 'AWD option', 'Spacious Cabin'] },
      { name: 'Hyundai Elantra', year: 2024, rating: 4.7, features: ['Digital Key', 'Bold Styling', 'Class-leading Warranty'] },
      { name: 'Hyundai Sonata', year: 2024, rating: 4.6, features: ['Panoramic Display', 'AWD standard', 'N Line Performance'] },
      { name: 'Hyundai Ioniq 6', year: 2024, rating: 4.8, features: ['Ultra-Fast Charging', 'E-GMP Platform', 'Aerodynamic Design'] },
      { name: 'Nissan Sentra', year: 2024, rating: 4.5, features: ['Zero Gravity Seats', 'Safety Shield 360', 'Fuel Efficient'] },
      { name: 'Nissan Altima', year: 2024, rating: 4.6, features: ['Intelligent AWD Standard', 'ProPILOT Assist', 'VC-Turbo'] },
      { name: 'Chevrolet Malibu', year: 2024, rating: 4.3, features: ['Smooth Ride', 'Wi-Fi Hotspot', 'Teen Driver Tech'] },
      { name: 'Dodge Charger', year: 2024, rating: 4.7, features: ['Muscle Sedan', 'HEMI Power', 'Widebody styling'] }
    ],
    'Coupe': [
      { name: 'Ford Mustang', year: 2024, rating: 4.8, features: ['5.0L V8 Coyote', 'Drift Brake', 'Digital Cockpit'] },
      { name: 'Dodge Challenger', year: 2024, rating: 4.7, features: ['Retro Styling', 'SRT Hellcat performance', 'Huge Trunk'] },
      { name: 'Nissan Z', year: 2024, rating: 4.7, features: ['Twin-Turbo V6', 'Manual Transmission', 'Heritage Design'] },
      { name: 'Subaru BRZ', year: 2024, rating: 4.8, features: ['Pure Handling', 'Lightweight', 'Boxer Engine'] },
      { name: 'Toyota GR86', year: 2024, rating: 4.9, features: ['Track-tuned', 'RWD Dynamics', 'Boxer Power'] }
    ],
    'Luxury': [
      { name: 'Chevrolet Corvette', year: 2024, rating: 5.0, features: ['Mid-Engine Supercar', '0-60 in 2.9s', 'Luxury Interior'] },
      { name: 'Nissan GT-R', year: 2024, rating: 4.8, features: ['Godzilla Performance', 'Hand-built Engine', 'Advanced AWD'] },
      { name: 'BMW 3 Series', year: 2024, rating: 4.9, features: ['xDrive AWD', 'Curved Display', 'Performance Balance'] },
      { name: 'Audi A4', year: 2024, rating: 4.7, features: ['Quattro AWD', 'Virtual Cockpit', 'Refined Cabin'] },
      { name: 'Mercedes-Benz C-Class', year: 2024, rating: 4.8, features: ['S-Class derived tech', 'Ambient Lighting', 'Smooth 4MATIC'] },
      { name: 'Cadillac CT5', year: 2024, rating: 4.6, features: ['Super Cruise', 'Blackwing performance', 'Magnetic Ride'] }
    ]
  },
  'SUV': {
    'Small (Compact)': [
      { name: 'Honda HR-V', year: 2024, rating: 4.6, features: ['Spacious Interior', 'Magic Seats', 'Honda Sensing'] },
      { name: 'Honda CR-V', year: 2024, rating: 4.9, features: ['Best-selling SUV', 'Hybrid available', 'Large Cargo'] },
      { name: 'Toyota RAV4', year: 2024, rating: 4.9, features: ['Off-road Capability', 'Hybrid/Prime options', 'AWD Standard'] },
      { name: 'Toyota Corolla Cross', year: 2024, rating: 4.7, features: ['Compact Efficiency', 'Hybrid available', 'AWD Standard'] },
      { name: 'Hyundai Venue', year: 2024, rating: 4.4, features: ['Urban Size', 'Easy Parking', 'Incredible Value'] },
      { name: 'Hyundai Kona', year: 2024, rating: 4.8, features: ['Modern Tech', 'EV option', 'N Line availability'] },
      { name: 'Hyundai Tucson', year: 2024, rating: 4.8, features: ['Remote Park Assist', 'Hybrid/Plug-in', 'Bold Design'] },
      { name: 'Hyundai Ioniq 5', year: 2024, rating: 4.9, features: ['Retro-Futuristic', 'EV Leader', 'Super Fast Charge'] },
      { name: 'Nissan Kicks', year: 2024, rating: 4.5, features: ['Efficient Urban', 'Bose Headrest Audio', 'Customizable'] },
      { name: 'Nissan Qashqai', year: 2024, rating: 4.6, features: ['Right-sized', 'Intelligent AWD', 'Safety Shield'] },
      { name: 'Nissan Rogue', year: 2024, rating: 4.7, features: ['VC-Turbo Engine', 'Zero Gravity Seats', 'ProPILOT Assist'] },
      { name: 'Nissan Ariya', year: 2024, rating: 4.7, features: ['Electric Luxury', 'Lounge Interior', 'Dual Motor AWD'] },
      { name: 'Ford Escape', year: 2024, rating: 4.5, features: ['Hybrid availability', 'Sliding 2nd Row', 'Sync 4'] },
      { name: 'Ford Bronco Sport', year: 2024, rating: 4.7, features: ['Safari Roof', 'G.O.A.T. Modes', 'Standard 4x4'] },
      { name: 'Chevrolet Trax', year: 2024, rating: 4.8, features: ['All-new Design', 'Budget-friendly', 'Feature rich'] },
      { name: 'Chevrolet Trailblazer', year: 2024, rating: 4.6, features: ['Two-tone roof', 'AWD available', 'RS styling'] },
      { name: 'Chevrolet Equinox', year: 2024, rating: 4.4, features: ['Proven Reliability', 'Safety Suite', 'Comfortable Ride'] },
      { name: 'GMC Terrain', year: 2024, rating: 4.5, features: ['AT4 Off-Road', 'Denali Luxury', 'Quiet Cabin'] },
      { name: 'Dodge Hornet', year: 2024, rating: 4.7, features: ['Italian platform', 'Turbo Power', 'Performance Hybrid'] }
    ],
    'Mid-Size': [
      { name: 'Honda Passport', year: 2024, rating: 4.7, features: ['Rugged Capability', 'V6 Power', 'Huge storage'] },
      { name: 'Honda Pilot', year: 2024, rating: 4.9, features: ['Seats 8', 'TrailSport edition', 'Removable 2nd row'] },
      { name: 'Toyota Highlander', year: 2024, rating: 4.9, features: ['Hybrid leader', 'AWD standard', 'Premium safety'] },
      { name: 'Toyota Grand Highlander', year: 2024, rating: 4.9, features: ['Adult-sized 3rd row', 'Hybrid MAX line', 'Luxury feel'] },
      { name: 'Toyota 4Runner', year: 2024, rating: 4.8, features: ['Legendary Rugged', 'Body-on-frame', 'Resale value'] },
      { name: 'Hyundai Santa Fe', year: 2024, rating: 4.9, features: ['Boxy All-new design', 'Three rows', 'Terrace Tailgate'] },
      { name: 'Hyundai Palisade', year: 2024, rating: 4.9, features: ['Elite Luxury', 'Ergo-Motion seat', 'Tow mode'] },
      { name: 'Nissan Murano', year: 2024, rating: 4.4, features: ['Plush Ride', 'V6 smooth', 'Premium interior'] },
      { name: 'Nissan Pathfinder', year: 2024, rating: 4.7, features: ['Rock Creek Edition', '9-speed Auto', 'Seats 8'] },
      { name: 'Ford Edge', year: 2024, rating: 4.4, features: ['12-inch screen', 'Standard AWD', 'Sporty ST model'] },
      { name: 'Ford Explorer', year: 2024, rating: 4.6, features: ['RWD platform', 'ST performance', 'Hybrid available'] },
      { name: 'Chevrolet Blazer', year: 2024, rating: 4.5, features: ['Camaro styling', 'Sporty handling', 'Electric Blazer EV'] },
      { name: 'Chevrolet Traverse', year: 2024, rating: 4.7, features: ['Massive interior', 'Z71 capability', 'High-tech screens'] },
      { name: 'GMC Acadia', year: 2024, rating: 4.8, features: ['All-new larger size', 'Super Cruise ready', 'AT4 capability'] },
      { name: 'Dodge Durango', year: 2024, rating: 4.6, features: ['Muscle SUV', 'Tows 8700 lbs', 'SRT performance'] }
    ],
    'Large (Full-Size)': [
      { name: 'Chevrolet Tahoe', year: 2024, rating: 4.9, features: ['Magnetic Ride Control', 'Z71 Off-Road', 'Super Cruise'] },
      { name: 'GMC Yukon', year: 2024, rating: 4.9, features: ['Denali Ultimate', 'Air Suspension', 'Max trailering'] },
      { name: 'Ford Expedition', year: 2024, rating: 4.8, features: ['EcoBoost V6', 'Stealth Edition', 'Heavy Duty Towing'] },
      { name: 'Nissan Armada', year: 2024, rating: 4.4, features: ['Luxury V8', 'Pro-4X capability', 'Massive cabin'] },
      { name: 'Toyota Sequoia', year: 2024, rating: 4.7, features: ['Hybrid Standard', 'TRD Pro model', 'Towing beast'] }
    ],
    'XL Large (Extended)': [
      { name: 'Chevrolet Suburban', year: 2024, rating: 4.9, features: ['Legendary Length', 'Best-in-class Cargo', 'Duramax Diesel'] },
      { name: 'GMC Yukon XL', year: 2024, rating: 4.9, features: ['Extended Range', 'Elite Luxury', 'Panoramic views'] },
      { name: 'Ford Expedition MAX', year: 2024, rating: 4.7, features: ['Long-wheelbase', 'Expansive comfort', 'Max trailer pkg'] }
    ]
  },
  'Truck': {
    '1/4 Ton (Compact/Mid)': [
      { name: 'Ford Maverick', year: 2024, rating: 4.9, features: ['Hybrid Standard', 'FLEXBED System', 'Perfect Urban Size'] },
      { name: 'Ford Ranger', year: 2024, rating: 4.8, features: ['Raptor Edition', 'Terrain Management', 'EcoBoost'] },
      { name: 'Chevrolet Colorado', year: 2024, rating: 4.9, features: ['ZR2 Off-Road', 'StowFlex Tailgate', 'Multimatic dampers'] },
      { name: 'GMC Canyon', year: 2024, rating: 4.9, features: ['Luxurious Interior', 'AT4X capability', 'High Output engine'] },
      { name: 'Toyota Tacoma', year: 2024, rating: 5.0, features: ['i-FORCE MAX Hybrid', 'Legendary Resale', 'TRD Off-Road'] },
      { name: 'Nissan Frontier', year: 2024, rating: 4.7, features: ['PRO-4X Rugged', 'Durable Exterior', 'Utili-track System'] },
      { name: 'Honda Ridgeline', year: 2024, rating: 4.8, features: ['In-bed Trunk', 'Dual-Action Tailgate', 'Standard AWD'] },
      { name: 'Hyundai Santa Cruz', year: 2024, rating: 4.7, features: ['Adventure Vehicle', 'In-bed locked storage', 'Sporty handling'] }
    ],
    '1/2 Ton (Light Duty)': [
      { name: 'GMC Sierra 1500', year: 2024, rating: 4.9, features: ['Denali Ultimate', 'MultiPro Tailgate', 'Super Cruise'] },
      { name: 'Chevrolet Silverado 1500', year: 2024, rating: 4.9, features: ['ZR2 Bison', 'Duramax Inline-6', 'High Country luxury'] },
      { name: 'Ford F-150', year: 2024, rating: 5.0, features: ['Raptor R 700HP', 'PowerBoost Hybrid', 'Pro Power Onboard'] },
      { name: 'Ram 1500', year: 2024, rating: 4.8, features: ['Air Suspension', 'Uconnect 5', 'TRX performance'] },
      { name: 'Toyota Tundra', year: 2024, rating: 4.7, features: ['i-FORCE MAX Hybrid', 'Composite Bed', 'Massive Screen'] }
    ],
    'Full Ton (Heavy Duty)': [
      { name: 'GMC Sierra 3500HD', year: 2024, rating: 4.9, features: ['Max Tow 36k lbs', 'Denali HD', 'ProGrade Trailering'] },
      { name: 'Chevrolet Silverado 3500HD', year: 2024, rating: 4.9, features: ['Allison Transmission', 'Duramax 6.6L', 'Camera views'] },
      { name: 'Ford F-350/450 Super Duty', year: 2024, rating: 5.0, features: ['1200 lb-ft Torque', 'Onboard Scales', 'Tremor Package'] },
      { name: 'Ram 3500 HD', year: 2024, rating: 4.8, features: ['High Output Cummins', 'Rear Air Support', 'Luxurious cabin'] }
    ]
  },
  'Van': {
    'Minivan': [
      { name: 'Honda Odyssey', year: 2024, rating: 4.8, features: ['Magic Slide Seats', 'CabinWatch', 'Reliable V6'] },
      { name: 'Toyota Sienna', year: 2024, rating: 4.9, features: ['AWD Hybrid', 'Extraordinarily Efficient', 'Modern Styling'] },
      { name: 'Chrysler Pacifica', year: 2024, rating: 4.9, features: ['Plug-in Hybrid', 'Stow \'n Go', 'Quiet Ride'] },
      { name: 'Kia Carnival', year: 2024, rating: 4.7, features: ['VIP Lounge', 'Slide-Flex seating', 'SUV styling'] }
    ],
    'Full-Size (Passenger/Cargo)': [
      { name: 'Ford Transit', year: 2024, rating: 4.8, features: ['AWD available', 'Electric E-Transit', 'High Roof'] },
      { name: 'Chevrolet Express', year: 2024, rating: 4.2, features: ['Heavy Duty', 'V8 reliability', 'Simple Utility'] },
      { name: 'GMC Savana', year: 2024, rating: 4.2, features: ['Workhorse', 'Standard V8', 'Large Capacity'] },
      { name: 'Mercedes-Benz Sprinter', year: 2024, rating: 4.9, features: ['All-wheel drive', 'Diesel efficiency', 'Luxury config'] }
    ]
  }
};

export const CatalogScreen = ({ formData, onBack, onVehicleComplete }: { 
  formData: FormData, 
  onBack: () => void,
  onVehicleComplete?: (vehicle: any) => void 
}) => {
  const categoryClasses = CANADIAN_INVENTORY[formData.vehicle] || CANADIAN_INVENTORY['Car'];
  const [comparedVehicles, setComparedVehicles] = useState<any[]>([]);
  const [showComparison, setShowComparison] = useState(false);

  const toggleCompare = (vehicle: any) => {
    setComparedVehicles(prev => {
      const isAlreadyAdded = prev.find(v => v.name === vehicle.name);
      if (isAlreadyAdded) {
        return prev.filter(v => v.name !== vehicle.name);
      }
      if (prev.length < 3) {
        playSound('selection');
        return [...prev, vehicle];
      }
      return prev;
    });
  };

  return (
    <div className="absolute inset-0 z-50 bg-bg-dark flex flex-col p-8 md:p-16 overflow-y-auto custom-scrollbar">
      <div className="max-w-7xl mx-auto w-full">
        <header className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-8 border-b border-white/5 pb-12">
          <div className="space-y-4">
            <button 
              onClick={onBack}
              className="flex items-center gap-2 text-white/40 hover:text-brand-cyan transition-colors group mb-4"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span className="text-[10px] uppercase tracking-widest font-bold">Return to Results</span>
            </button>
            <h1 className="text-5xl md:text-7xl font-display font-medium tracking-tight">
              {(formData.vehicle || 'Vehicle').toUpperCase()} <span className="text-brand-cyan">PORTFOLIO</span>
            </h1>
            <p className="text-white/40 tracking-[0.3em] uppercase text-xs">
              Direct Access to Approved Inventory // Comparison Mode Enabled
            </p>
          </div>

          <div className="flex items-center gap-8">
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-widest text-white/20 font-bold mb-1">Comparison Tray</span>
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {[0, 1, 2].map((i) => (
                    <div 
                      key={i} 
                      className={`w-10 h-10 rounded-full border-2 border-bg-dark flex items-center justify-center transition-all ${
                        comparedVehicles[i] 
                          ? 'bg-brand-cyan text-bg-dark border-brand-cyan shadow-[0_0_15px_rgba(214,51,36,0.3)]' 
                          : 'bg-white/5 border-white/10 text-white/10'
                      }`}
                    >
                      {comparedVehicles[i] ? comparedVehicles[i].name.charAt(0) : <Plus className="w-3 h-3" />}
                    </div>
                  ))}
                </div>
                <button
                  disabled={comparedVehicles.length < 2}
                  onClick={() => setShowComparison(true)}
                  className={`px-8 py-3 rounded text-[10px] uppercase tracking-[0.2em] font-bold transition-all ${
                    comparedVehicles.length >= 2
                      ? 'bg-brand-cyan text-bg-dark hover:scale-105 active:scale-95 cursor-pointer shadow-[0_0_30px_rgba(214,51,36,0.2)]'
                      : 'bg-white/5 text-white/20 cursor-not-allowed border border-white/10'
                  }`}
                >
                  {comparedVehicles.length < 2 ? `Select ${2 - comparedVehicles.length} More` : 'Compare Now'}
                </button>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {comparedVehicles.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 50 }}
                className="fixed bottom-6 md:bottom-12 left-1/2 -translate-x-1/2 z-60 bg-bg-dark/95 border border-white/10 backdrop-blur-3xl p-2 rounded-full shadow-2xl flex items-center gap-2 pointer-events-auto scale-90 sm:scale-100"
              >
                <div className="flex items-center px-4 md:px-6 gap-4 md:gap-6">
                  <div className="flex flex-col">
                    <span className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Selected</span>
                    <span className="text-[10px] font-mono text-brand-cyan">{comparedVehicles.length} / 3</span>
                  </div>
                  <div className="h-6 w-[1px] bg-white/10" />
                  <button
                    onClick={() => setShowComparison(true)}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-[9px] uppercase tracking-[0.3em] font-bold text-white hover:text-brand-cyan transition-all"
                  >
                    Compare Ready
                  </button>
                  <div className="h-6 w-[1px] bg-white/10" />
                  <button 
                    onClick={() => setComparedVehicles([])}
                    className="p-2 text-white/40 hover:text-brand-purple transition-colors"
                    title="Clear Selection"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <div className="space-y-32">
          {Object.entries(categoryClasses).map(([subClass, models], sectionIdx) => (
            <div key={subClass} className="space-y-12">
              <div className="flex items-center gap-8 group">
                <div className="w-1.5 h-12 bg-brand-cyan/20 group-hover:bg-brand-cyan transition-colors" />
                <div className="space-y-1">
                  <h2 className="text-3xl font-display uppercase tracking-[0.15em] text-white">
                    {subClass}
                  </h2>
                  <div className="flex items-center gap-4 text-[10px] font-mono text-white/30 uppercase tracking-widest">
                    <span>North American Standard</span>
                    <div className="w-1 h-1 rounded-full bg-white/20" />
                    <span>{models.length} Variants Available</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-12">
                {models.map((item, i) => {
                  const isSelected = comparedVehicles.find(v => v.name === item.name);
                  return (
                    <motion.div
                      key={item.name}
                      initial={{ opacity: 0, y: 40 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (sectionIdx * 0.1) + (i * 0.05), duration: 0.8, ease: CINEMATIC_EASE }}
                      className={`group relative flex flex-col h-full rounded-sm border-t border-white/5 transition-all duration-500 hover:border-brand-cyan/40 px-2 pt-8 ${
                        isSelected ? 'bg-white/[0.02]' : ''
                      }`}
                    >
                      {/* Comparison Overlay */}
                      <div className="absolute top-0 right-0 p-4">
                        <button
                          onClick={() => toggleCompare(item)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-full text-[10px] uppercase tracking-widest font-bold transition-all border ${
                            isSelected 
                              ? 'bg-brand-cyan text-bg-dark border-brand-cyan shadow-[0_0_15px_rgba(214,51,36,0.3)]' 
                              : 'bg-white/5 text-white/40 border-white/10 hover:border-white/20'
                          }`}
                        >
                          {isSelected ? (
                            <>
                              <Check className="w-3 h-3" />
                              Added
                            </>
                          ) : (
                            <>
                              <Layers className="w-3 h-3" />
                              Compare
                            </>
                          )}
                        </button>
                      </div>

                      <div className="mb-8 pr-12">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[10px] font-mono text-brand-purple tracking-widest">RANK_0{i+1}</span>
                          <div className="h-[1px] w-4 bg-white/10" />
                          <div className="flex items-center gap-1 text-brand-cyan/60 text-[10px]">
                            <Star className="w-3 h-3 fill-current" />
                            {item.rating}
                          </div>
                        </div>
                        <h3 className="text-2xl font-display font-medium tracking-tight group-hover:text-brand-cyan transition-colors leading-tight mb-1 capitalize">
                          {item.name}
                        </h3>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/20 font-bold">Production Year {item.year}</span>
                      </div>

                      <div className="space-y-4 mb-10 flex-1">
                        {item.features.map((feature: string) => (
                          <div key={feature} className="flex items-start gap-3 text-[11px] text-white/40 font-light tracking-wide leading-relaxed group-hover:text-white/60 transition-colors">
                            <div className="w-[3px] h-[3px] rounded-full bg-brand-cyan/40 mt-[7px] shrink-0" />
                            {feature}
                          </div>
                        ))}
                      </div>

              <button 
                onClick={() => onVehicleComplete?.(item)}
                className="w-full flex items-center justify-between group/row border-t border-white/5 pt-6 pb-4 md:pb-2 hover:text-brand-cyan transition-colors"
              >
                        <span className="text-[10px] uppercase tracking-[0.3em] font-bold">Select Configuration</span>
                        <ArrowLeft className="w-4 h-4 rotate-180 opacity-20 group-hover/row:opacity-100 group-hover/row:translate-x-2 transition-all" />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <AnimatePresence>
          {showComparison && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-100 bg-bg-dark/98 backdrop-blur-3xl flex items-center justify-center p-4 md:p-12 pointer-events-auto overflow-y-auto custom-scrollbar"
            >
              <div className="w-full max-w-7xl pt-20 pb-20">
                <div className="flex items-center justify-between mb-20 border-b border-white/5 pb-12">
                  <div className="space-y-2">
                    <h2 className="text-5xl font-display font-medium tracking-tight">TECHNICAL <span className="text-brand-cyan">BENCHMARK</span></h2>
                    <p className="text-white/30 text-xs uppercase tracking-[0.4em] font-mono">Side-by-side verification protocol</p>
                  </div>
                  <button 
                    onClick={() => setShowComparison(false)}
                    className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:border-brand-purple hover:bg-brand-purple/5 transition-all"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                  {comparedVehicles.map((v, i) => (
                    <motion.div
                      key={v.name}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="relative border-x border-white/5 px-8 flex flex-col"
                    >
                      <div className="space-y-6 mb-16">
                        <div className="flex items-center justify-between">
                          <span className="bg-brand-cyan/10 text-brand-cyan px-2 py-1 rounded text-[10px] font-mono tracking-widest font-bold">V_MODEL_{i+1}</span>
                          <button 
                            onClick={() => toggleCompare(v)}
                            className="text-white/20 hover:text-brand-purple"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-4xl font-display font-medium tracking-tight h-20 flex items-end">{v.name}</h3>
                          <div className="flex items-center gap-3 text-white/40 text-[10px] font-mono uppercase">
                            <div className="flex items-center gap-1 text-brand-cyan">
                              <Star className="w-3 h-3 fill-current" />
                              {v.rating}
                            </div>
                            <div className="h-3 w-[1px] bg-white/10" />
                            <span>Expert Verification</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-12 flex-1">
                        <div className="space-y-6">
                          <h4 className="text-[10px] uppercase tracking-[0.4em] text-white/20 font-bold flex items-center gap-4">
                            Capabilities
                            <div className="h-[1px] flex-1 bg-white/5" />
                          </h4>
                          <div className="grid gap-4">
                            {v.features.map((f: string) => (
                              <div key={f} className="flex gap-4 p-4 rounded bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                                <div className="w-1.5 h-1.5 rounded-full bg-brand-cyan mt-1 shadow-[0_0_8px_rgba(214,51,36,0.4)]" />
                                <span className="text-xs text-white/60 leading-relaxed italic font-light">{f}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="pt-16 mt-auto">
                        <ActionButton 
                          active 
                          className="w-full h-14 text-xs tracking-[0.2em]"
                          onClick={() => onVehicleComplete?.(v)}
                        >
                          Confirm Selection
                        </ActionButton>
                      </div>
                    </motion.div>
                  ))}
                  
                  {Array.from({ length: 3 - comparedVehicles.length }).map((_, i) => (
                    <div key={i} className="border border-dashed border-white/5 flex flex-col items-center justify-center p-12 text-center group rounded-lg opacity-40 hover:opacity-100 transition-opacity">
                      <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                        <Plus className="w-6 h-6 text-white/20" />
                      </div>
                      <h4 className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/40 mb-2">Empty Slot</h4>
                      <p className="text-[9px] uppercase tracking-widest text-white/10 max-w-[150px]">Select another vehicle from our inventory</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <footer className="mt-24 pt-12 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-8 opacity-40 pb-12">
          <div className="flex flex-col gap-1">
            <div className="text-[9px] uppercase tracking-[0.3em] font-mono">
              DISCLAIMER: PRICING SUBJECT TO CREDIT APPROVAL // EST. 4.9% APR
            </div>
            <div className="text-[8px] uppercase tracking-[0.5em] font-mono text-brand-cyan">
              Secured by DA ARC Intelligence System
            </div>
          </div>
          <div className="flex items-center gap-12">
            <ShieldCheck className="w-4 h-4 cursor-help" />
            <Info className="w-4 h-4 cursor-help" />
          </div>
        </footer>
      </div>
    </div>
  );
};
