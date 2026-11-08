import React from 'react';
import { NavLink } from 'react-router-dom';
import './Navigation.css';

function Navigation() {
  return (
    <nav className="navigation">
      <NavLink 
        to="/" 
        end
        className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
      >
        🔌 Charging
      </NavLink>
      <NavLink 
        to="/devices" 
        className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
      >
        📱 Devices
      </NavLink>
      <NavLink 
        to="/statistics" 
        className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
      >
        📊 Statistics
      </NavLink>
      <NavLink
        to="/diagnostics"
        className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
      >
        🩺 Diagnostics
      </NavLink>
    </nav>
  );
}

export default Navigation;
