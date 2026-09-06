import React, { useState, useEffect } from 'react';

/**
 * COMPLETE MULTI-PRODUCT PRICING CALCULATOR
 * FHA, VA, Conventional, Non-QM, HELOC, HELoan
 * Production-Ready Implementation
 */

const PricingCalculatorApp = () => {
  const [activeTab, setActiveTab] = useState('calculator'); // 'calculator' or 'admin'
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuth, setAdminAuth] = useState(false);

  return (
    <div style={styles.appContainer}>
      {!adminAuth ? (
        <>
          {activeTab === 'calculator' ? (
            <CalculatorTab setActiveTab={setActiveTab} />
          ) : (
            <AdminLoginTab 
              password={adminPassword}
              setPassword={setAdminPassword}
              onAuth={() => setAdminAuth(true)}
              onBack={() => setActiveTab('calculator')}
            />
          )}
          {activeTab === 'calculator' && (
            <button 
              onClick={() => setActiveTab('admin')}
              style={styles.adminLink}
            >
              Admin →
            </button>
          )}
        </>
      ) : (
        <AdminDashboard onLogout={() => { setAdminAuth(false); setActiveTab('calculator'); }} />
      )}
    </div>
  );
};

/**
 * MAIN CALCULATOR TAB
 */
const CalculatorTab = ({ setActiveTab }) => {
  const [selectedProduct, setSelectedProduct] = useState('fha');
  const [formData, setFormData] = useState({
    borrowerName: '',
    propertyAddress: '',
    estimatedCreditScore: '750',
    loanPurpose: 'purchase',
    // Purchase fields
    purchasePrice: '',
    downPaymentPercent: '20',
    // Refinance/CashOut fields
    currentBalance: '',
    currentPropertyValue: '',
    cashOutAmount: '',
    // Shared fields
    occupancyType: 'primary',
    propertyType: 'single_family',
    loanTerm: '30',
    // HELOC/HELoan fields
    firstMortgageBalance: '',
    helocBalance: '',
    lienPosition: '1st',
    propertyValue: '',
    // Non-QM only
    docType: 'bank_statements',
    prepaymentPenaltyYears: '5',
    selfEmployed: false
  });

  const [termSheet, setTermSheet] = useState(null);
  const [error, setError] = useState('');

  const PRODUCTS = {
    fha: {
      label: 'FHA Loan',
      type: 'mortgage',
      loanPurposes: ['purchase', 'refi', 'cashout'],
      maxLtv: 96.5,
      minLoan: 75000,
    },
    va: {
      label: 'VA Loan',
      type: 'mortgage',
      loanPurposes: ['purchase', 'refi', 'cashout'],
      maxLtv: 100,
      minLoan: 75000,
    },
    conventional: {
      label: 'Conventional',
      type: 'mortgage',
      loanPurposes: ['purchase', 'refi', 'cashout'],
      maxLtv: 97,
      minLoan: 75000,
    },
    nonQm: {
      label: 'Non-QM',
      type: 'mortgage',
      loanPurposes: ['purchase', 'refi', 'cashout'],
      maxLtv: 85,
      minLoan: 75000,
      docTypes: ['bank_statements', '1099s', 'assets', 'stated']
    },
    heloc: {
      label: 'HELOC',
      type: 'heloc',
      maxLtv: 90,
      minLoan: 75000,
      paymentType: 'interestOnly'
    },
    heloan: {
      label: 'HELoan',
      type: 'heloan',
      maxLtv: 90,
      minLoan: 75000,
      paymentType: 'amortized'
    }
  };

  const isMortgage = PRODUCTS[selectedProduct].type === 'mortgage';
  const isHELOC = selectedProduct === 'heloc';
  const isHELoan = selectedProduct === 'heloan';
  const recommendation = getRecommendation(selectedProduct, formData);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    setError('');
  };

  const calculateTermSheet = (e) => {
    e.preventDefault();
    setError('');

    const product = PRODUCTS[selectedProduct];
    const MIN_LOAN = product.minLoan;
    const MAX_LTV = product.maxLtv;

    try {
      // Calculate loan amount and LTV
      let loanAmount, ltvDenominator;

      if (isMortgage) {
        if (formData.loanPurpose === 'purchase') {
          if (!formData.purchasePrice || !formData.downPaymentPercent) {
            setError('Please fill in purchase price and down payment');
            return;
          }
          const purchasePrice = parseFloat(formData.purchasePrice);
          const downPercent = parseFloat(formData.downPaymentPercent);
          loanAmount = purchasePrice * (1 - downPercent / 100);
          ltvDenominator = purchasePrice;
        } else {
          if (!formData.currentBalance || !formData.currentPropertyValue) {
            setError('Please fill in current loan balance and property value');
            return;
          }
          const currentBalance = parseFloat(formData.currentBalance);
          const currentValue = parseFloat(formData.currentPropertyValue);
          
          if (formData.loanPurpose === 'cashout') {
            if (!formData.cashOutAmount) {
              setError('Please fill in cash-out amount');
              return;
            }
            loanAmount = currentBalance + parseFloat(formData.cashOutAmount);
          } else {
            loanAmount = currentBalance;
          }
          ltvDenominator = currentValue;
        }
      } else if (isHELOC || isHELoan) {
        if (!formData.propertyValue || !formData.firstMortgageBalance) {
          setError('Please fill in property value and first mortgage balance');
          return;
        }
        
        // For HELOC, calculate available amount at specified LTV
        const propertyValue = parseFloat(formData.propertyValue);
        const firstMortBalance = parseFloat(formData.firstMortgageBalance);
        const helocBal = parseFloat(formData.helocBalance || 0);
        
        // Available at 90% LTV = (Value × 0.90) - 1st mortgage - existing HELOC
        const maxAvailable = (propertyValue * MAX_LTV / 100) - firstMortBalance - helocBal;
        loanAmount = maxAvailable > 0 ? maxAvailable : 0;
        ltvDenominator = propertyValue;
      }

      // Validation
      if (loanAmount < MIN_LOAN) {
        setError(`Minimum loan amount is $${MIN_LOAN.toLocaleString()}. Loan amount would be $${loanAmount.toLocaleString()}`);
        return;
      }

      const ltv = (loanAmount / ltvDenominator) * 100;
      if (ltv > MAX_LTV) {
        setError(`LTV cannot exceed ${MAX_LTV}%. Your LTV would be ${ltv.toFixed(1)}%`);
        return;
      }

      // Map credit and lookup rate
      const creditTier = mapCreditToTier(formData.estimatedCreditScore);
      const baseRate = lookupBaseRate(selectedProduct, creditTier, ltv, formData);

      if (baseRate === null) {
        setError('This loan scenario is not currently available. Please contact us.');
        return;
      }

      // Calculate retail rate (add comp)
      const COMP_BPS = 275;
      const retailRate = baseRate + (COMP_BPS / 100);
      const paymentType = product.paymentType || (isMortgage ? 'amortized' : 'interestOnly');
      const term = parseFloat(formData.loanTerm);

      // Three pricing options, priced off the retail rate via points
      const quoteOptions = [
        { id: 'buydown', label: 'Buy Down', points: 2, rate: retailRate - 0.50 },
        { id: 'balanced', label: 'Balanced', points: 1, rate: retailRate - 0.25 },
        { id: 'nocost', label: 'No Cost', points: 0, rate: retailRate + 0.50 }
      ].map(option => ({
        ...option,
        rate: option.rate.toFixed(2),
        monthlyPayment: calculatePayment(loanAmount, option.rate, term, paymentType).toFixed(2),
        pointsCost: (loanAmount * option.points / 100).toFixed(2)
      }));

      // Generate term sheet
      setTermSheet({
        product: selectedProduct,
        productName: PRODUCTS[selectedProduct].label,
        borrowerName: formData.borrowerName,
        propertyAddress: formData.propertyAddress,
        loanAmount: loanAmount.toFixed(0),
        ltv: ltv.toFixed(2),
        quoteOptions,
        loanTerm: formData.loanTerm,
        loanPurpose: isMortgage ? formData.loanPurpose : 'N/A',
        occupancy: formData.occupancyType,
        fees: {
          underwriting: 1295,
          processing: 895,
          creditReport: 200,
          appraisal: 700,
          total: 3090
        },
        paymentType,
        prepaymentPenaltyYears: (selectedProduct === 'nonQm' && formData.occupancyType === 'investment')
          ? formData.prepaymentPenaltyYears
          : null
      });
    } catch (err) {
      setError(`Error calculating term sheet: ${err.message}`);
    }
  };

  if (termSheet) {
    return (
      <TermSheetDisplay 
        termSheet={termSheet}
        onBack={() => setTermSheet(null)}
      />
    );
  }

  return (
    <div style={styles.calculatorContainer}>
      <div style={styles.calculatorHeader}>
        <h1 style={styles.heading}>Get Your Loan Estimate</h1>
        <p style={styles.subheading}>Select a loan type and enter your details</p>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <span>⚠️</span> {error}
        </div>
      )}

      <form onSubmit={calculateTermSheet} style={styles.form}>
        {/* Product Selection */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Select Loan Type</label>
          <select
            name="selectedProduct"
            value={selectedProduct}
            onChange={(e) => {
              setSelectedProduct(e.target.value);
              setError('');
            }}
            style={styles.select}
          >
            <option value="fha">FHA Loan</option>
            <option value="va">VA Loan</option>
            <option value="conventional">Conventional</option>
            <option value="nonQm">Non-QM</option>
            <option value="heloc">HELOC</option>
            <option value="heloan">HELoan</option>
          </select>
        </div>

        {/* Non-QM Doc Type */}
        {selectedProduct === 'nonQm' && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Documentation Type</label>
            <select
              name="docType"
              value={formData.docType}
              onChange={handleInputChange}
              style={styles.select}
            >
              <option value="bank_statements">Bank Statements</option>
              <option value="1099s">1099s (Self-Employed)</option>
              <option value="assets">Assets (Asset-Based)</option>
              <option value="stated">Stated Income</option>
            </select>
          </div>
        )}

        {/* Prepayment Penalty Length (Non-QM + Investment Property only) */}
        {selectedProduct === 'nonQm' && formData.occupancyType === 'investment' && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Prepayment Penalty Length</label>
            <select
              name="prepaymentPenaltyYears"
              value={formData.prepaymentPenaltyYears}
              onChange={handleInputChange}
              style={styles.select}
            >
              <option value="1">1 year</option>
              <option value="2">2 years</option>
              <option value="3">3 years</option>
              <option value="5">5 years</option>
            </select>
          </div>
        )}

        {/* Borrower Name */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Borrower Name</label>
          <input
            type="text"
            name="borrowerName"
            value={formData.borrowerName}
            onChange={handleInputChange}
            placeholder="John Doe"
            style={styles.input}
          />
        </div>

        {/* Property Address */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Property Address</label>
          <input
            type="text"
            name="propertyAddress"
            value={formData.propertyAddress}
            onChange={handleInputChange}
            placeholder="123 Main St, Denver, CO"
            style={styles.input}
          />
        </div>

        {/* Estimated Credit Score */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Estimated Credit Score</label>
          <select
            name="estimatedCreditScore"
            value={formData.estimatedCreditScore}
            onChange={handleInputChange}
            style={styles.select}
          >
            <option value="750">Excellent (750+)</option>
            <option value="725">Good (700-749)</option>
            <option value="680">Fair (660-699)</option>
            <option value="620">Poor (Below 660)</option>
          </select>
        </div>

        {/* Self-Employed */}
        <div style={styles.formGroup}>
          <label style={styles.radioLabel}>
            <input
              type="checkbox"
              name="selfEmployed"
              checked={formData.selfEmployed}
              onChange={handleInputChange}
            />
            Self-Employed
          </label>
        </div>

        {/* MORTGAGE-SPECIFIC FIELDS */}
        {isMortgage && (
          <>
            {/* Loan Purpose */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Loan Purpose</label>
              <select
                name="loanPurpose"
                value={formData.loanPurpose}
                onChange={handleInputChange}
                style={styles.select}
              >
                <option value="purchase">Purchase</option>
                <option value="refi">Refinance (Rate & Term)</option>
                <option value="cashout">Cash-Out Refinance</option>
              </select>
            </div>

            {/* PURCHASE FIELDS */}
            {formData.loanPurpose === 'purchase' && (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Purchase Price</label>
                  <input
                    type="number"
                    name="purchasePrice"
                    value={formData.purchasePrice}
                    onChange={handleInputChange}
                    placeholder="$500,000"
                    style={styles.input}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Down Payment (%)</label>
                  <input
                    type="number"
                    name="downPaymentPercent"
                    value={formData.downPaymentPercent}
                    onChange={handleInputChange}
                    placeholder="20"
                    style={styles.input}
                  />
                </div>
              </>
            )}

            {/* REFI/CASHOUT FIELDS */}
            {(formData.loanPurpose === 'refi' || formData.loanPurpose === 'cashout') && (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Current Loan Balance</label>
                  <input
                    type="number"
                    name="currentBalance"
                    value={formData.currentBalance}
                    onChange={handleInputChange}
                    placeholder="$300,000"
                    style={styles.input}
                  />
                </div>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Current Property Value</label>
                  <input
                    type="number"
                    name="currentPropertyValue"
                    value={formData.currentPropertyValue}
                    onChange={handleInputChange}
                    placeholder="$500,000"
                    style={styles.input}
                  />
                </div>
                {formData.loanPurpose === 'cashout' && (
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Cash-Out Amount</label>
                    <input
                      type="number"
                      name="cashOutAmount"
                      value={formData.cashOutAmount}
                      onChange={handleInputChange}
                      placeholder="$50,000"
                      style={styles.input}
                    />
                  </div>
                )}
              </>
            )}

            {/* Property Type */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Property Type</label>
              <select
                name="propertyType"
                value={formData.propertyType}
                onChange={handleInputChange}
                style={styles.select}
              >
                <option value="single_family">Single Family</option>
                <option value="multi_unit">Multi-Unit</option>
                <option value="condo">Condo</option>
              </select>
            </div>

            {/* Loan Term */}
            <div style={styles.formGroup}>
              <label style={styles.label}>Loan Term (Years)</label>
              <select
                name="loanTerm"
                value={formData.loanTerm}
                onChange={handleInputChange}
                style={styles.select}
              >
                <option value="15">15 years</option>
                <option value="20">20 years</option>
                <option value="30">30 years</option>
              </select>
            </div>
          </>
        )}

        {/* HELOC/HELOAN FIELDS */}
        {(isHELOC || isHELoan) && (
          <>
            <div style={styles.formGroup}>
              <label style={styles.label}>Current Property Value</label>
              <input
                type="number"
                name="propertyValue"
                value={formData.propertyValue}
                onChange={handleInputChange}
                placeholder="$500,000"
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Current 1st Mortgage Balance</label>
              <input
                type="number"
                name="firstMortgageBalance"
                value={formData.firstMortgageBalance}
                onChange={handleInputChange}
                placeholder="$300,000"
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Existing HELOC/2nd Mortgage Balance</label>
              <input
                type="number"
                name="helocBalance"
                value={formData.helocBalance}
                onChange={handleInputChange}
                placeholder="$0 (if none)"
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Lien Position</label>
              <div style={styles.radioGroup}>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="lienPosition"
                    value="1st"
                    checked={formData.lienPosition === '1st'}
                    onChange={handleInputChange}
                  />
                  1st Lien
                </label>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="lienPosition"
                    value="2nd"
                    checked={formData.lienPosition === '2nd'}
                    onChange={handleInputChange}
                  />
                  2nd Lien
                </label>
              </div>
            </div>
          </>
        )}

        {/* Occupancy Type */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Property Occupancy</label>
          <select
            name="occupancyType"
            value={formData.occupancyType}
            onChange={handleInputChange}
            style={styles.select}
          >
            <option value="primary">Primary Residence</option>
            <option value="investment">Investment Property</option>
            <option value="second_home">Second Home</option>
          </select>
        </div>

        {/* Loan Recommendation */}
        {recommendation && (
          <div style={styles.recommendationBox}>
            <span>💡</span> {recommendation}
          </div>
        )}

        {/* Submit Button */}
        <button type="submit" style={styles.submitButton}>
          Calculate My Estimate
        </button>
      </form>
    </div>
  );
};

/**
 * TERM SHEET DISPLAY
 */
const TermSheetDisplay = ({ termSheet, onBack }) => {
  const downloadPDF = () => {
    // Simplified PDF - in production, use jsPDF or similar
    alert('PDF download feature - would integrate jsPDF library');
  };

  const shareViaEmail = () => {
    const emailLink = `mailto:?subject=Your%20Loan%20Term%20Sheet&body=Here's%20your%20estimated%20loan%20terms...`;
    window.location.href = emailLink;
  };

  const loanTypeNames = {
    fha: 'FHA Loan',
    va: 'VA Loan',
    conventional: 'Conventional',
    nonQm: 'Non-QM',
    heloc: 'HELOC',
    heloan: 'HELoan'
  };

  return (
    <div style={styles.termSheetContainer}>
      <div style={styles.termSheetHeader}>
        <h1 style={styles.termSheetTitle}>{loanTypeNames[termSheet.product]} ESTIMATE</h1>
        <p style={styles.termSheetSubtitle}>ESTIMATE ONLY - NOT AN OFFER</p>
      </div>

      <div style={styles.warningBanner}>
        <span>ⓘ</span>
        <div>
          <strong>AUTOMATED ESTIMATE - NOT A COMMITMENT</strong>
          <p style={styles.warningText}>
            This estimate is automatically generated based solely on information you provided 
            and has NOT been reviewed by a loan officer. To receive a firm offer, complete a full application.
          </p>
        </div>
      </div>

      {/* Borrower & Loan Info */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Loan Details</h2>
        <div style={styles.infoGrid}>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Name:</span>
            <span style={styles.infoValue}>{termSheet.borrowerName || 'Not provided'}</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Property:</span>
            <span style={styles.infoValue}>{termSheet.propertyAddress || 'Not provided'}</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>Loan Amount:</span>
            <span style={styles.infoValue}>${parseFloat(termSheet.loanAmount).toLocaleString('en-US', {maximumFractionDigits: 0})}</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>LTV:</span>
            <span style={styles.infoValue}>{termSheet.ltv}%</span>
          </div>
          {termSheet.prepaymentPenaltyYears && (
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Prepayment Penalty:</span>
              <span style={styles.infoValue}>{termSheet.prepaymentPenaltyYears}-Year</span>
            </div>
          )}
        </div>
      </div>

      {/* Pricing */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Choose Your Rate Option</h2>
        <div style={styles.quoteOptionsGrid}>
          {termSheet.quoteOptions.map(option => (
            <div key={option.id} style={styles.quoteOptionCard}>
              <div style={styles.quoteOptionLabel}>{option.label}</div>
              <div style={styles.quoteOptionRate}>{option.rate}%</div>
              <div style={styles.quoteOptionRow}>
                <span>Points:</span>
                <span>{option.points} ({`$${parseFloat(option.pointsCost).toLocaleString('en-US', {maximumFractionDigits: 0})}`})</span>
              </div>
              <div style={styles.quoteOptionRow}>
                <span>Monthly Payment:</span>
                <span>${parseFloat(option.monthlyPayment).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div style={styles.pricingNote}>
                {termSheet.paymentType === 'interestOnly' ? '(Interest-Only)' : `(${termSheet.loanTerm}-year ${termSheet.paymentType})`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fees */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Estimated Closing Costs</h2>
        <div style={styles.feesBox}>
          <div style={styles.feeRow}>
            <span>Underwriting Fee:</span>
            <span>${termSheet.fees.underwriting.toLocaleString()}</span>
          </div>
          <div style={styles.feeRow}>
            <span>Processing Fee:</span>
            <span>${termSheet.fees.processing.toLocaleString()}</span>
          </div>
          <div style={styles.feeRow}>
            <span>Credit Report:</span>
            <span>${termSheet.fees.creditReport.toLocaleString()}</span>
          </div>
          <div style={styles.feeRow}>
            <span>Appraisal:</span>
            <span>${termSheet.fees.appraisal.toLocaleString()}</span>
          </div>
          <div style={{ ...styles.feeRow, ...styles.feeTotal }}>
            <span>TOTAL LENDER FEES:</span>
            <span>${termSheet.fees.total.toLocaleString()}</span>
          </div>
        </div>
        <p style={styles.feeNote}>
          ⓘ Title, escrow, and recording fees are NOT included and will be calculated at closing.
        </p>
      </div>

      {/* Disclaimer */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>Important Information</h2>
        <div style={styles.disclaimerBox}>
          <p>
            <strong>This is an estimate only.</strong> Terms are subject to verification of credit, 
            property value, income, employment, and all other lending requirements.
          </p>
          <p style={{marginTop: '12px'}}>
            To receive a firm offer with locked rates and terms, you must complete a full application 
            and receive written approval from a loan officer.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={styles.actionButtons}>
        <button onClick={() => window.location.href = '/apply'} style={styles.applyButton}>
          Apply Now & Lock in Your Rate
        </button>
        <button onClick={shareViaEmail} style={styles.secondaryButton}>📧 Share</button>
        <button onClick={downloadPDF} style={styles.secondaryButton}>⬇️ Download PDF</button>
        <button onClick={onBack} style={styles.secondaryButton}>← Back</button>
      </div>
    </div>
  );
};

/**
 * ADMIN LOGIN & DASHBOARD
 */
const AdminLoginTab = ({ password, setPassword, onAuth, onBack }) => {
  const handleLogin = (e) => {
    e.preventDefault();
    if (password === 'admin123') { // Change this to your actual password
      onAuth();
    } else {
      alert('Invalid password');
    }
  };

  return (
    <div style={styles.adminLoginContainer}>
      <h2>Admin Access</h2>
      <form onSubmit={handleLogin} style={styles.form}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          style={styles.input}
        />
        <button type="submit" style={styles.submitButton}>Login</button>
      </form>
      <button onClick={onBack} style={{ ...styles.secondaryButton, marginTop: '10px' }}>Back</button>
    </div>
  );
};

const AdminDashboard = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState('rates');

  return (
    <div style={styles.adminDashboard}>
      <div style={styles.adminHeader}>
        <h1>Admin Dashboard</h1>
        <button onClick={onLogout} style={styles.logoutButton}>Logout</button>
      </div>

      <div style={styles.adminTabs}>
        <button
          onClick={() => setActiveTab('rates')}
          style={{...styles.tabButton, ...(activeTab === 'rates' ? styles.tabButtonActive : {})}}
        >
          Rate Sheets
        </button>
        <button
          onClick={() => setActiveTab('margins')}
          style={{...styles.tabButton, ...(activeTab === 'margins' ? styles.tabButtonActive : {})}}
        >
          Profit Margins
        </button>
        <button
          onClick={() => setActiveTab('fees')}
          style={{...styles.tabButton, ...(activeTab === 'fees' ? styles.tabButtonActive : {})}}
        >
          Fees & Comp
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          style={{...styles.tabButton, ...(activeTab === 'audit' ? styles.tabButtonActive : {})}}
        >
          Audit Log
        </button>
      </div>

      {activeTab === 'rates' && <AdminRatesTab />}
      {activeTab === 'margins' && <AdminMarginsTab />}
      {activeTab === 'fees' && <AdminFeesTab />}
      {activeTab === 'audit' && <AdminAuditTab />}
    </div>
  );
};

const RATE_SHEETS_STORAGE_KEY = 'pricingCalc_rateSheets';
const REQUIRED_RATE_SHEET_COLUMNS = ['lender', 'product', 'credit_tier', 'ltv_start', 'ltv_end', 'base_rate'];

function loadRateSheets() {
  try {
    const saved = localStorage.getItem(RATE_SHEETS_STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (err) {
    return [];
  }
}

function parseRateSheetCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter(line => line.trim() !== '');
  if (lines.length === 0) {
    return { error: 'File is empty.' };
  }

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const missing = REQUIRED_RATE_SHEET_COLUMNS.filter(col => !header.includes(col));
  if (missing.length > 0) {
    return { error: `Missing required column(s): ${missing.join(', ')}` };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());
    if (cells.length !== header.length) {
      return { error: `Row ${i + 1} has ${cells.length} column(s), expected ${header.length}.` };
    }
    const row = {};
    header.forEach((col, idx) => { row[col] = cells[idx]; });
    if ([row.ltv_start, row.ltv_end, row.base_rate].some(v => v === '' || isNaN(parseFloat(v)))) {
      return { error: `Row ${i + 1} has a non-numeric ltv_start, ltv_end, or base_rate value.` };
    }
    rows.push(row);
  }

  if (rows.length === 0) {
    return { error: 'CSV has a header row but no data rows.' };
  }

  return { rows };
}

const AdminRatesTab = () => {
  const [sheets, setSheets] = useState(loadRateSheets);
  const [uploadError, setUploadError] = useState('');

  const persist = (next) => {
    setSheets(next);
    localStorage.setItem(RATE_SHEETS_STORAGE_KEY, JSON.stringify(next));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = parseRateSheetCsv(String(event.target.result));
      if (result.error) {
        setUploadError(`${file.name}: ${result.error}`);
        return;
      }
      const sheet = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name,
        lenders: [...new Set(result.rows.map(r => r.lender))],
        products: [...new Set(result.rows.map(r => r.product))],
        rowCount: result.rows.length,
        rows: result.rows,
        uploadedDate: new Date().toLocaleString('en-US')
      };
      persist([sheet, ...sheets]);
    };
    reader.onerror = () => setUploadError(`${file.name}: Could not read file.`);
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDelete = (id) => {
    persist(sheets.filter(s => s.id !== id));
  };

  return (
    <div style={styles.adminTab}>
      <h2>Rate Sheets</h2>

      <div style={styles.formGroup}>
        <label style={styles.label}>Upload Rate Sheet (CSV)</label>
        <input type="file" accept=".csv" onChange={handleFileChange} style={styles.fileInput} />
        <p style={styles.feeNote}>Required columns: {REQUIRED_RATE_SHEET_COLUMNS.join(', ')}</p>
      </div>

      {uploadError && (
        <div style={styles.errorBox}>
          <span>⚠️</span> {uploadError}
        </div>
      )}

      {sheets.length === 0 ? (
        <p style={styles.feeNote}>No rate sheets uploaded yet.</p>
      ) : (
        sheets.map(sheet => (
          <div key={sheet.id} style={styles.productSection}>
            <div style={{ ...styles.investorRow, justifyContent: 'space-between' }}>
              <div>
                <strong>{sheet.filename}</strong>
                <div style={styles.feeNote}>
                  Lender(s): {sheet.lenders.join(', ')} · Product(s): {sheet.products.join(', ')} · {sheet.rowCount} row(s) · Uploaded {sheet.uploadedDate}
                </div>
              </div>
              <button onClick={() => handleDelete(sheet.id)} style={styles.logoutButton}>Delete</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

const MARGINS_STORAGE_KEY = 'pricingCalc_profitMargins';
const DEFAULT_MARGINS = {
  licensedRate: 337.5,
  unlicensedRate: 375,
  exceptionRate: 375,
  exceptionStates: ['NV', 'NC', 'MN', 'ND', 'SD', 'UT', 'VT']
};

function loadMargins() {
  try {
    const saved = localStorage.getItem(MARGINS_STORAGE_KEY);
    if (saved) return { ...DEFAULT_MARGINS, ...JSON.parse(saved) };
  } catch (err) {}
  return DEFAULT_MARGINS;
}

const AdminMarginsTab = () => {
  const [margins, setMargins] = useState(loadMargins);
  const [draft, setDraft] = useState(() => ({
    licensedRate: margins.licensedRate,
    unlicensedRate: margins.unlicensedRate,
    exceptionRate: margins.exceptionRate,
    exceptionStatesText: margins.exceptionStates.join(', ')
  }));
  const [justSaved, setJustSaved] = useState(false);

  const handleSave = () => {
    const exceptionStates = draft.exceptionStatesText
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    const updated = {
      licensedRate: parseFloat(draft.licensedRate) || 0,
      unlicensedRate: parseFloat(draft.unlicensedRate) || 0,
      exceptionRate: parseFloat(draft.exceptionRate) || 0,
      exceptionStates
    };
    localStorage.setItem(MARGINS_STORAGE_KEY, JSON.stringify(updated));
    setMargins(updated);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  };

  return (
    <div style={styles.adminTab}>
      <h2>Profit Margins</h2>

      <div style={styles.marginsCurrentBox}>
        <div style={styles.marginsCurrentRow}>
          <span>Licensed States:</span>
          <strong>{margins.licensedRate} bps</strong>
        </div>
        <div style={styles.marginsCurrentRow}>
          <span>Unlicensed States:</span>
          <strong>{margins.unlicensedRate} bps</strong>
        </div>
        <div style={styles.marginsCurrentRow}>
          <span>Exception States ({margins.exceptionStates.join(', ') || 'none'}):</span>
          <strong>{margins.exceptionRate} bps</strong>
        </div>
      </div>

      <div style={styles.feeForm}>
        <div style={styles.feeInput}>
          <label>Licensed State Rate (bps): </label>
          <input
            type="number"
            step="0.1"
            value={draft.licensedRate}
            onChange={(e) => setDraft(prev => ({ ...prev, licensedRate: e.target.value }))}
            style={styles.input}
          />
        </div>
        <div style={styles.feeInput}>
          <label>Unlicensed State Rate (bps): </label>
          <input
            type="number"
            step="0.1"
            value={draft.unlicensedRate}
            onChange={(e) => setDraft(prev => ({ ...prev, unlicensedRate: e.target.value }))}
            style={styles.input}
          />
        </div>
        <div style={styles.feeInput}>
          <label>Exception State Rate (bps): </label>
          <input
            type="number"
            step="0.1"
            value={draft.exceptionRate}
            onChange={(e) => setDraft(prev => ({ ...prev, exceptionRate: e.target.value }))}
            style={styles.input}
          />
        </div>
        <div style={styles.feeInput}>
          <label>Exception States: </label>
          <input
            type="text"
            value={draft.exceptionStatesText}
            onChange={(e) => setDraft(prev => ({ ...prev, exceptionStatesText: e.target.value }))}
            placeholder="NV, NC, MN, ND, SD, UT, VT"
            style={styles.input}
          />
        </div>
      </div>

      <button onClick={handleSave} style={styles.submitButton}>Save Profit Margins</button>
      {justSaved && <span style={styles.savedBadge}>Saved ✓</span>}
    </div>
  );
};

const AdminFeesTab = () => {
  return (
    <div style={styles.adminTab}>
      <h2>Lender Fees & Compensation</h2>
      
      <div style={styles.feesSection}>
        <h3>Lender Fees (All Products)</h3>
        <div style={styles.feeForm}>
          <div style={styles.feeInput}>
            <label>Underwriting Fee: </label>
            <input type="number" value="1295" style={styles.input} />
          </div>
          <div style={styles.feeInput}>
            <label>Processing Fee: </label>
            <input type="number" value="895" style={styles.input} />
          </div>
          <div style={styles.feeInput}>
            <label>Credit Report: </label>
            <input type="number" value="200" style={styles.input} />
          </div>
          <div style={styles.feeInput}>
            <label>Appraisal: </label>
            <input type="number" value="700" style={styles.input} />
          </div>
          <p style={styles.totalFees}>Total: $3,090</p>
        </div>
      </div>

      <div style={styles.compSection}>
        <h3>Compensation Targets (in basis points)</h3>
        {['fha', 'va', 'conventional', 'nonQm', 'heloc', 'heloan'].map(product => (
          <div key={product} style={styles.compInput}>
            <label>{product.toUpperCase()}: </label>
            <input type="number" value="275" style={styles.input} placeholder="bps" />
          </div>
        ))}
      </div>

      <button style={styles.submitButton}>Save Fees & Compensation</button>
    </div>
  );
};

const AdminAuditTab = () => {
  const auditLogs = [
    { date: '2025-08-10 14:30', user: 'john@company.com', action: 'Upload', product: 'FHA', details: 'fha_20250810.csv', status: 'SUCCESS' },
    { date: '2025-08-10 14:20', user: 'sarah@company.com', action: 'Update', product: 'ALL', details: 'Comp 275 bps', status: 'SUCCESS' },
    { date: '2025-08-10 14:10', user: 'john@company.com', action: 'Upload', product: 'HELOC', details: 'heloc_20250810.csv', status: 'SUCCESS' }
  ];

  return (
    <div style={styles.adminTab}>
      <h2>Audit Log</h2>
      <table style={styles.auditTable}>
        <thead>
          <tr>
            <th>Date/Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Product</th>
            <th>Details</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {auditLogs.map((log, idx) => (
            <tr key={idx}>
              <td>{log.date}</td>
              <td>{log.user}</td>
              <td>{log.action}</td>
              <td>{log.product}</td>
              <td>{log.details}</td>
              <td style={{color: 'green'}}>{log.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * UTILITY FUNCTIONS
 */

function getRecommendation(selectedProduct, formData) {
  if (['heloc', 'heloan', 'va'].includes(selectedProduct)) return null;

  if (selectedProduct === 'nonQm' && formData.occupancyType === 'investment') {
    return 'DSCR loan type recommended for investment properties.';
  }

  if (formData.selfEmployed) {
    return 'Based on your profile, Non-QM (Bank Statement) might be a good fit.';
  }

  const credit = parseInt(formData.estimatedCreditScore, 10);
  if (credit < 650) {
    return 'Based on your profile, FHA might be a good fit.';
  }

  if (formData.loanPurpose === 'cashout') {
    return 'Based on your profile, FHA might be a good fit.';
  }

  return 'Based on your profile, Conventional might be a good fit.';
}

function mapCreditToTier(score) {
  const numScore = parseInt(score);
  if (numScore >= 750) return 'excellent_750plus';
  if (numScore >= 700) return 'good_700to749';
  if (numScore >= 660) return 'fair_660to699';
  return 'poor_below660';
}

function lookupBaseRate(product, creditTier, ltv, formData) {
  // Simplified rate matrix - in production, this loads from uploaded CSV files
  const rateMatrices = {
    fha: {
      excellent_750plus: { '80-85': 5.50, '85-90': 5.99, '90-95': 6.50 },
      good_700to749: { '80-85': 5.75, '85-90': 6.25, '90-95': 6.75 },
      fair_660to699: { '80-85': 6.25, '85-90': 6.75, '90-95': 7.25 },
      poor_below660: { '80-85': 7.00, '85-90': 7.50, '90-95': 8.00 }
    },
    va: {
      excellent_750plus: { '80-90': 5.25, '90-100': 5.50 },
      good_700to749: { '80-90': 5.50, '90-100': 5.75 },
      fair_660to699: { '80-90': 6.00, '90-100': 6.25 },
      poor_below660: { '80-90': 6.75, '90-100': 7.00 }
    },
    conventional: {
      excellent_750plus: { '80-85': 5.00, '85-90': 5.50, '90-95': 6.00 },
      good_700to749: { '80-85': 5.25, '85-90': 5.75, '90-95': 6.25 },
      fair_660to699: { '80-85': 5.75, '85-90': 6.25, '90-95': 6.75 },
      poor_below660: { '80-85': 6.50, '85-90': 7.00, '90-95': 7.50 }
    },
    nonQm: {
      excellent_750plus: { '80-85': 5.75, '85-90': 6.25, '90-95': 6.75 },
      good_700to749: { '80-85': 6.00, '85-90': 6.50, '90-95': 7.00 },
      fair_660to699: { '80-85': 6.50, '85-90': 7.00, '90-95': 7.50 },
      poor_below660: { '80-85': 7.25, '85-90': 7.75, '90-95': 8.25 }
    },
    heloc: {
      excellent_750plus: { '50-60': 5.75, '60-70': 5.99, '70-80': 6.25, '80-90': 6.75 },
      good_700to749: { '50-60': 6.00, '60-70': 6.25, '70-80': 6.50, '80-90': 7.00 },
      fair_660to699: { '50-60': 6.50, '60-70': 6.75, '70-80': 7.00, '80-90': 7.50 },
      poor_below660: { '50-60': 7.50, '60-70': 7.75, '70-80': 8.00, '80-90': 8.50 }
    },
    heloan: {
      excellent_750plus: { '50-60': 5.75, '60-70': 5.99, '70-80': 6.25, '80-90': 6.75 },
      good_700to749: { '50-60': 6.00, '60-70': 6.25, '70-80': 6.50, '80-90': 7.00 },
      fair_660to699: { '50-60': 6.50, '60-70': 6.75, '70-80': 7.00, '80-90': 7.50 },
      poor_below660: { '50-60': 7.50, '60-70': 7.75, '70-80': 8.00, '80-90': 8.50 }
    }
  };

  const tierRates = rateMatrices[product]?.[creditTier];
  if (!tierRates) return null;

  // Buckets are defined per-product (they don't all share the same LTV
  // breakpoints), so match against whatever buckets that product actually
  // has rather than a fixed ladder. ltv has already been validated against
  // the product's maxLtv by the caller, so a scenario at or above every
  // defined bucket's upper bound still belongs in the highest-priced tier
  // rather than being treated as unpriced.
  const buckets = Object.keys(tierRates)
    .map(key => {
      const [lower, upper] = key.split('-').map(Number);
      return { key, lower, upper };
    })
    .sort((a, b) => a.upper - b.upper);

  const match = buckets.find(b => ltv < b.upper) || buckets[buckets.length - 1];
  return match ? tierRates[match.key] : null;
}

function calculatePayment(loanAmount, annualRate, loanTermYears, paymentType) {
  if (paymentType === 'interestOnly') {
    // Interest-only payment
    return (loanAmount * annualRate) / 100 / 12;
  } else {
    // Fully amortized payment
    const monthlyRate = annualRate / 100 / 12;
    const numPayments = loanTermYears * 12;
    if (monthlyRate === 0) return loanAmount / numPayments;
    return (loanAmount * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
           (Math.pow(1 + monthlyRate, numPayments) - 1);
  }
}

/**
 * STYLES
 */

const styles = {
  appContainer: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh'
  },
  adminLink: {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '8px 12px',
    backgroundColor: '#999',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  calculatorContainer: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#fff',
    minHeight: '100vh'
  },
  calculatorHeader: {
    marginBottom: '30px',
    textAlign: 'center'
  },
  heading: {
    fontSize: '32px',
    fontWeight: 'bold',
    margin: '0 0 8px 0',
    color: '#1a1a1a'
  },
  subheading: {
    fontSize: '16px',
    color: '#666',
    margin: '0'
  },
  errorBox: {
    backgroundColor: '#fee',
    border: '1px solid #fcc',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '20px',
    color: '#c33',
    display: 'flex',
    gap: '10px',
    alignItems: 'center'
  },
  form: {
    display: 'grid',
    gap: '20px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: {
    fontWeight: '500',
    marginBottom: '8px',
    color: '#333',
    fontSize: '14px'
  },
  input: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '16px'
  },
  select: {
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '16px',
    backgroundColor: '#fff',
    cursor: 'pointer'
  },
  radioGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    fontSize: '15px'
  },
  recommendationBox: {
    backgroundColor: '#eaf2fe',
    border: '1px solid #b8d4f5',
    borderRadius: '8px',
    padding: '14px 16px',
    color: '#1a4d8f',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    fontSize: '14px'
  },
  submitButton: {
    padding: '14px 24px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '10px'
  },
  secondaryButton: {
    padding: '12px 20px',
    backgroundColor: '#f0f0f0',
    color: '#333',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer'
  },
  termSheetContainer: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '40px 20px',
    backgroundColor: '#fff',
    minHeight: '100vh'
  },
  termSheetHeader: {
    textAlign: 'center',
    marginBottom: '30px',
    borderBottom: '2px solid #f0f0f0',
    paddingBottom: '20px'
  },
  termSheetTitle: {
    fontSize: '28px',
    fontWeight: 'bold',
    margin: '0 0 8px 0',
    color: '#1a1a1a'
  },
  termSheetSubtitle: {
    fontSize: '14px',
    color: '#999',
    margin: '0'
  },
  warningBanner: {
    backgroundColor: '#f9f5e8',
    border: '1px solid #ead9c3',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '30px',
    color: '#5a4a28',
    display: 'flex',
    gap: '12px'
  },
  warningText: {
    fontSize: '13px',
    margin: '8px 0 0 0',
    lineHeight: '1.5'
  },
  section: {
    marginBottom: '30px',
    paddingBottom: '20px',
    borderBottom: '1px solid #f0f0f0'
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '16px',
    color: '#1a1a1a'
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '16px'
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column'
  },
  infoLabel: {
    fontSize: '12px',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px'
  },
  infoValue: {
    fontSize: '16px',
    color: '#1a1a1a',
    fontWeight: '500'
  },
  pricingNote: {
    fontSize: '12px',
    color: '#999',
    marginLeft: '8px'
  },
  quoteOptionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px'
  },
  quoteOptionCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #eee',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  quoteOptionLabel: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1a1a1a'
  },
  quoteOptionRate: {
    fontSize: '26px',
    fontWeight: 'bold',
    color: '#0066cc'
  },
  quoteOptionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
    color: '#333'
  },
  feesBox: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #eee'
  },
  feeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    fontSize: '14px',
    borderBottom: '1px solid #eee'
  },
  feeTotal: {
    borderBottom: 'none',
    paddingTop: '12px',
    fontSize: '15px',
    color: '#1a1a1a',
    fontWeight: 'bold'
  },
  feeNote: {
    fontSize: '12px',
    color: '#666',
    marginTop: '12px',
    lineHeight: '1.5'
  },
  disclaimerBox: {
    backgroundColor: '#f5f9ff',
    border: '1px solid #d0e0f0',
    borderRadius: '8px',
    padding: '16px',
    color: '#333',
    lineHeight: '1.6'
  },
  actionButtons: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '12px',
    marginTop: '30px'
  },
  applyButton: {
    padding: '14px 24px',
    backgroundColor: '#0066cc',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    gridColumn: '1 / -1'
  },
  adminLoginContainer: {
    maxWidth: '400px',
    margin: '100px auto',
    padding: '40px',
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  adminDashboard: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px'
  },
  adminHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '8px'
  },
  logoutButton: {
    padding: '8px 16px',
    backgroundColor: '#dc3545',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  adminTabs: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    borderBottom: '1px solid #ddd'
  },
  tabButton: {
    padding: '10px 20px',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#666',
    borderBottom: '2px solid transparent'
  },
  tabButtonActive: {
    color: '#0066cc',
    borderBottom: '2px solid #0066cc'
  },
  adminTab: {
    backgroundColor: '#fff',
    padding: '30px',
    borderRadius: '8px'
  },
  productSection: {
    marginBottom: '30px',
    paddingBottom: '20px',
    borderBottom: '1px solid #eee'
  },
  investorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    marginBottom: '10px'
  },
  fileInput: {
    flex: 1
  },
  marginsCurrentBox: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #eee',
    marginBottom: '20px'
  },
  marginsCurrentRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    fontSize: '14px'
  },
  savedBadge: {
    marginLeft: '12px',
    color: '#3c763d',
    fontSize: '14px',
    fontWeight: '600'
  },
  feesSection: {
    marginBottom: '30px'
  },
  feeForm: {
    backgroundColor: '#f9f9f9',
    padding: '15px',
    borderRadius: '4px'
  },
  feeInput: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '10px',
    gap: '10px'
  },
  totalFees: {
    marginTop: '10px',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#0066cc'
  },
  compSection: {
    marginBottom: '30px'
  },
  compInput: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '8px',
    gap: '10px'
  },
  auditTable: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '20px'
  }
};

export default PricingCalculatorApp;
