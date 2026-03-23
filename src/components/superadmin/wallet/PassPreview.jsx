
import React from 'react';
import { Wallet } from 'lucide-react';

const ApplePassMock = ({ project, passData }) => {
    const {
        imageIds = {},
        colors = {},
        organizationName = 'Empresa',
        fields = {}
    } = passData;

    const { backgroundColor = '#000000', labelColor = '#ffffff', textColor = '#ffffff' } = colors;
    const { icon, logo, strip } = imageIds;
    
    // Create a predictable field order
    const fieldOrder = ['displayName', 'points', 'tier'];
    const primaryFields = Object.entries(fields)
        .filter(([key]) => fieldOrder.includes(key) && key !== 'tier')
        .sort(([a], [b]) => fieldOrder.indexOf(a) - fieldOrder.indexOf(b));

    const secondaryFields = Object.entries(fields).filter(([key]) => !fieldOrder.includes(key));

    const getFieldLabel = (key) => {
        return project?.field_mapping?.fields?.find(f => f.key === key)?.label || key;
    };

    return (
        <div style={{ backgroundColor }} className="w-full max-w-[290px] h-[360px] rounded-2xl p-3 flex flex-col text-white shadow-lg mx-auto font-sans transition-colors duration-300">
            <header className="flex items-center mb-2">
                {icon ? 
                    <img src={icon} alt="icon" className="w-8 h-8 rounded-full mr-2 bg-white object-contain" />
                    : <div className="w-8 h-8 rounded-full mr-2 bg-white/20 flex items-center justify-center"><Wallet className="w-4 h-4 text-white/70" /></div>}
                <p style={{ color: labelColor }} className="text-xs">{organizationName}</p>
            </header>
            
            <div className="relative w-full h-24 bg-black/20 rounded-t-lg mb-2 flex items-center justify-center">
                {strip && <img src={strip} alt="strip" className="w-full h-full object-cover rounded-t-lg" />}
                {!strip && <span className="text-xs" style={{color: labelColor}}>Strip Image</span>}
                {logo && <img src={logo} alt="logo" className="absolute top-3 left-3 h-8 object-contain"/>}
            </div>

            <main className="flex-grow grid grid-cols-2 gap-x-4 px-2">
                 {primaryFields.map(([key, value]) => (
                    <div key={key} className="truncate">
                        <p style={{ color: labelColor }} className="text-[10px] uppercase tracking-wide">{getFieldLabel(key)}</p>
                        <p style={{ color: textColor }} className="text-lg font-semibold truncate">{value || '...'}</p>
                    </div>
                ))}
            </main>

            <footer className="border-t border-white/20 mt-auto pt-2 px-2 grid grid-cols-2 gap-x-4">
                 {secondaryFields.map(([key, value]) => (
                    <div key={key} className="truncate">
                        <p style={{ color: labelColor }} className="text-[10px] uppercase tracking-wide">{getFieldLabel(key)}</p>
                        <p style={{ color: textColor }} className="text-sm font-medium">{value || '...'}</p>
                    </div>
                 ))}
            </footer>
        </div>
    );
};


const GooglePassMock = ({ project, passData }) => {
    const {
        imageIds = {},
        colors = {},
        organizationName = 'Empresa',
        fields = {}
    } = passData;

    const { backgroundColor = '#000000', textColor = '#ffffff' } = colors;
    const { logo, hero } = imageIds;

    const getFieldLabel = (key) => {
        return project?.field_mapping?.fields?.find(f => f.key === key)?.label || key;
    };
    
    return (
        <div className="w-full max-w-[290px] rounded-2xl shadow-lg mx-auto bg-white overflow-hidden transition-colors duration-300">
            <header style={{ backgroundColor }} className="p-3 flex justify-between items-start">
                <p style={{ color: textColor }} className="text-lg font-bold">{organizationName}</p>
                {logo ? <img src={logo} alt="logo" className="h-10 w-10 bg-white rounded-md p-1 object-contain"/>
                      : <div className="h-10 w-10 bg-white/20 rounded-md flex items-center justify-center"><Wallet className="w-5 h-5" /></div>}
            </header>
            <div className="w-full h-24 bg-black/10 flex items-center justify-center">
                {hero ? <img src={hero} alt="hero" className="w-full h-24 object-cover" />
                      : <span className="text-xs text-gray-500">Hero Image</span>}
            </div>
            <main className="p-4 space-y-4">
                 {Object.entries(fields).map(([key, value]) => (
                    <div key={key}>
                        <p className="text-xs text-gray-500 uppercase">{getFieldLabel(key)}</p>
                        <p className="text-lg font-medium text-gray-900">{value || '...'}</p>
                    </div>
                 ))}
            </main>
        </div>
    );
};


const PassPreview = ({ project, passData, viewMode }) => {
    return (
        <div>
            {viewMode === 'apple' 
                ? <ApplePassMock passData={passData} project={project}/> 
                : <GooglePassMock passData={passData} project={project}/>
            }
        </div>
    );
};

export default PassPreview;
