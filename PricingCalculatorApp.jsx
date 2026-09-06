import React, { useState, useEffect, useRef } from 'react';
import html2pdf from 'html2pdf.js';

/**
 * COMPLETE MULTI-PRODUCT PRICING CALCULATOR
 * FHA, VA, Conventional, Non-QM, HELOC, HELoan
 * Production-Ready Implementation
 */

const PricingCalculatorApp = () => {
  const [activeTab, setActiveTab] = useState('prequal'); // 'prequal' | 'calculator' | 'admin'
  const [adminPassword, setAdminPassword] = useState('');
  const [adminAuth, setAdminAuth] = useState(false);

  // Lifted to this top level (rather than local to each tab) so filled-in
  // data survives switching tabs, per the "data persists" requirement.
  const [prequalForm, setPrequalForm] = useState(getDefaultPrequalForm);
  const [prequalResults, setPrequalResults] = useState(null);
  const [calculatorPrefill, setCalculatorPrefill] = useState(null);

  const handleGetDetailedQuote = (program, lender) => {
    const product = mapLoanTypeToProduct(program.loanType);
    const isMortgageProduct = ['fha', 'va', 'conventional', 'nonQm'].includes(product);
    const amount = prequalForm.loanAmount ? Number(prequalForm.loanAmount) : null;
    const value = prequalForm.propertyValue ? Number(prequalForm.propertyValue) : null;

    const prefill = {
      seq: Date.now(),
      product,
      lenderName: lender.name,
      programLoanType: program.loanType,
      purpose: prequalForm.purpose,
      propertyType: mapPrequalPropertyType(prequalForm.propertyType),
      occupancyType: mapPrequalOccupancy(prequalForm.occupancy),
      estimatedCreditScore: prequalForm.creditScore,
      docType: derivePrequalDocType(prequalForm.incomeTypes, prequalForm.occupancy)
    };

    if (isMortgageProduct) {
      if (prequalForm.purpose === 'purchase') {
        if (value) {
          prefill.purchasePrice = String(value);
          if (amount) prefill.downPaymentPercent = (((value - amount) / value) * 100).toFixed(1);
        }
      } else {
        if (value) prefill.currentPropertyValue = String(value);
        // For a rate/term refi the requested loan amount IS the balance being
        // refinanced. For cash-out, "loan amount" is balance + cash out
        // combined, and we have no reliable way to split that - leave
        // currentBalance/cashOutAmount for the borrower to fill in themselves
        // rather than guess a wrong split.
        if (prequalForm.purpose === 'refi' && amount) prefill.currentBalance = String(amount);
      }
    } else if (value) {
      prefill.propertyValue = String(value);
    }

    setCalculatorPrefill(prefill);
    setActiveTab('calculator');
  };

  return (
    <div style={styles.appContainer}>
      <div style={styles.mainNav} className="no-print">
        <button
          onClick={() => setActiveTab('prequal')}
          style={{ ...styles.mainNavButton, ...(activeTab === 'prequal' ? styles.mainNavButtonActive : {}) }}
        >
          Pre-Qualification
        </button>
        <button
          onClick={() => setActiveTab('calculator')}
          style={{ ...styles.mainNavButton, ...(activeTab === 'calculator' ? styles.mainNavButtonActive : {}) }}
        >
          Calculator
        </button>
        <button
          onClick={() => setActiveTab('admin')}
          style={{ ...styles.mainNavButton, ...(activeTab === 'admin' ? styles.mainNavButtonActive : {}) }}
        >
          Admin
        </button>
      </div>

      {activeTab === 'prequal' && (
        <PreQualTab
          formData={prequalForm}
          setFormData={setPrequalForm}
          results={prequalResults}
          setResults={setPrequalResults}
          onGetDetailedQuote={handleGetDetailedQuote}
        />
      )}
      {activeTab === 'calculator' && (
        <CalculatorTab
          prefill={calculatorPrefill}
          onPrefillConsumed={() => setCalculatorPrefill(null)}
        />
      )}
      {activeTab === 'admin' && (
        adminAuth ? (
          <AdminDashboard onLogout={() => { setAdminAuth(false); setActiveTab('prequal'); }} />
        ) : (
          <AdminLoginTab
            password={adminPassword}
            setPassword={setAdminPassword}
            onAuth={() => setAdminAuth(true)}
            onBack={() => setActiveTab('prequal')}
          />
        )
      )}
    </div>
  );
};

/**
 * MAIN CALCULATOR TAB
 */
const CalculatorTab = ({ prefill, onPrefillConsumed }) => {
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
    selfEmployed: false,
    lenderName: ''
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

  useEffect(() => {
    if (!prefill) return;
    setSelectedProduct(prefill.product);
    setFormData(prev => ({
      ...prev,
      ...(prefill.lenderName && { lenderName: prefill.lenderName }),
      ...(prefill.purpose && { loanPurpose: prefill.purpose }),
      ...(prefill.propertyType && { propertyType: prefill.propertyType }),
      ...(prefill.occupancyType && { occupancyType: prefill.occupancyType }),
      ...(prefill.estimatedCreditScore && { estimatedCreditScore: prefill.estimatedCreditScore }),
      ...(prefill.docType && { docType: prefill.docType }),
      ...(prefill.purchasePrice && { purchasePrice: prefill.purchasePrice }),
      ...(prefill.downPaymentPercent && { downPaymentPercent: prefill.downPaymentPercent }),
      ...(prefill.currentPropertyValue && { currentPropertyValue: prefill.currentPropertyValue }),
      ...(prefill.currentBalance && { currentBalance: prefill.currentBalance }),
      ...(prefill.propertyValue && { propertyValue: prefill.propertyValue })
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.seq]);

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

      const fees = {
        underwriting: 1295,
        processing: 895,
        creditReport: 200,
        appraisal: 700,
        total: 3090
      };
      const isCashout = isMortgage && formData.loanPurpose === 'cashout';
      const currentBalanceNum = isCashout ? parseFloat(formData.currentBalance) : null;

      // Three pricing options, priced off the retail rate via points
      const quoteOptions = [
        { id: 'buydown', label: 'Buy Down', points: 2, rate: retailRate - 0.50 },
        { id: 'balanced', label: 'Balanced', points: 1, rate: retailRate - 0.25 },
        { id: 'nocost', label: 'No Cost', points: 0, rate: retailRate + 0.50 }
      ].map(option => {
        const pointsCost = loanAmount * option.points / 100;
        const result = {
          ...option,
          rate: option.rate.toFixed(2),
          monthlyPayment: calculatePayment(loanAmount, option.rate, term, paymentType).toFixed(2),
          pointsCost: pointsCost.toFixed(2)
        };
        if (isCashout) {
          // Total closing costs for THIS option = flat lender fees + this
          // option's points cost, since points are money the borrower pays
          // (or nets out of proceeds) at closing just like any other fee.
          const cashOut = loanAmount - currentBalanceNum - (fees.total + pointsCost);
          result.cashOutAmount = cashOut.toFixed(2);
        }
        return result;
      });

      // Generate term sheet
      setTermSheet({
        product: selectedProduct,
        productName: PRODUCTS[selectedProduct].label,
        borrowerName: formData.borrowerName,
        lenderName: formData.lenderName,
        propertyAddress: formData.propertyAddress,
        loanAmount: loanAmount.toFixed(0),
        ltv: ltv.toFixed(2),
        quoteOptions,
        loanTerm: formData.loanTerm,
        loanPurpose: isMortgage ? formData.loanPurpose : 'N/A',
        occupancy: formData.occupancyType,
        currentBalance: isCashout ? currentBalanceNum.toFixed(0) : null,
        fees,
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

      {prefill && (
        <div style={styles.prequalBanner}>
          <span>
            Pre-Qualified via <strong>{prefill.lenderName}</strong> — {prefill.programLoanType}. Loan type below has been pre-selected as a starting point.
          </span>
          <button onClick={onPrefillConsumed} style={styles.prequalBannerDismiss} aria-label="Dismiss">×</button>
        </div>
      )}

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

        {/* Lender (carried over from Pre-Qualification, if any) */}
        <div style={styles.formGroup}>
          <label style={styles.label}>Lender (optional)</label>
          <input
            type="text"
            name="lenderName"
            value={formData.lenderName}
            onChange={handleInputChange}
            placeholder="e.g. Cake - Broker"
            style={styles.input}
          />
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
 * PRE-QUALIFICATION TAB
 */
const PreQualTab = ({ formData, setFormData, results, setResults, onGetDetailedQuote }) => {
  const [matrix, setMatrix] = useState({ lenders: [], programs: [] });
  const [loadState, setLoadState] = useState('loading'); // 'loading' | 'ready' | 'error'

  useEffect(() => {
    let cancelled = false;
    fetchLenderMatrix()
      .then(data => { if (!cancelled) { setMatrix(data); setLoadState('ready'); } })
      .catch(() => { if (!cancelled) setLoadState('error'); });
    return () => { cancelled = true; };
  }, []);

  const set = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));
  const toggleIncome = (type) => setFormData(prev => ({
    ...prev,
    incomeTypes: prev.incomeTypes.includes(type)
      ? prev.incomeTypes.filter(t => t !== type)
      : [...prev.incomeTypes, type]
  }));

  const runMatch = (e) => {
    e.preventDefault();
    const crit = {
      purpose: formData.purpose,
      propertyType: formData.propertyType,
      occupancy: formData.occupancy,
      incomeTypes: formData.incomeTypes,
      fico: formData.creditScore,
      state: formData.state.toUpperCase(),
      loanAmount: formData.loanAmount,
      propertyValue: formData.propertyValue,
      ltv: (formData.propertyValue && formData.loanAmount)
        ? (Number(formData.loanAmount) / Number(formData.propertyValue)) * 100
        : null
    };
    const matches = [];
    matrix.programs.forEach(program => {
      const lender = matrix.lenders.find(l => l.id === program.lenderId);
      if (!lender) return;
      const result = evaluatePrequalProgram(program, lender, crit);
      if (result) matches.push(result);
    });
    matches.sort((a, b) => (b.maxLoanAvail || 0) - (a.maxLoanAvail || 0));
    setResults(matches);
  };

  const uniqueLenderNames = results ? [...new Set(results.map(r => r.lender.name))] : [];

  return (
    <div style={styles.calculatorContainer}>
      <div style={styles.calculatorHeader}>
        <h1 style={styles.heading}>Pre-Qualification</h1>
        <p style={styles.subheading}>See which lenders you may qualify with in seconds</p>
      </div>

      {loadState === 'error' && (
        <div style={styles.errorBox}>
          <span>⚠️</span> Couldn't load the lender matrix right now. Please try again shortly.
        </div>
      )}

      <form onSubmit={runMatch} style={styles.form}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Loan Purpose</label>
          <select style={styles.select} value={formData.purpose} onChange={e => set('purpose', e.target.value)}>
            <option value="purchase">Purchase</option>
            <option value="refi">Refinance (Rate & Term)</option>
            <option value="cashout">Cash-Out Refinance</option>
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Property Type</label>
          <select style={styles.select} value={formData.propertyType} onChange={e => set('propertyType', e.target.value)}>
            {PREQUAL_PROP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Occupancy</label>
          <select style={styles.select} value={formData.occupancy} onChange={e => set('occupancy', e.target.value)}>
            {PREQUAL_OCC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Income Source(s) — select all that apply</label>
          <div>
            {PREQUAL_INCOME_TYPES.map(t => (
              <button
                type="button"
                key={t}
                onClick={() => toggleIncome(t)}
                style={{
                  ...styles.prequalToggle,
                  ...(formData.incomeTypes.includes(t) ? styles.prequalToggleActive : {})
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Estimated Credit Score</label>
          <select style={styles.select} value={formData.creditScore} onChange={e => set('creditScore', e.target.value)}>
            <option value="750">Excellent (750+)</option>
            <option value="725">Good (700-749)</option>
            <option value="680">Fair (660-699)</option>
            <option value="620">Poor (Below 660)</option>
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Loan Amount</label>
          <input
            type="number"
            style={styles.input}
            value={formData.loanAmount}
            onChange={e => set('loanAmount', e.target.value)}
            placeholder="$400,000"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Estimated Property Value (optional — improves match accuracy)</label>
          <input
            type="number"
            style={styles.input}
            value={formData.propertyValue}
            onChange={e => set('propertyValue', e.target.value)}
            placeholder="$500,000"
          />
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Property State</label>
          <select style={styles.select} value={formData.state} onChange={e => set('state', e.target.value)}>
            <option value="">Select a state</option>
            {PREQUAL_US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <button type="submit" style={styles.submitButton} disabled={loadState !== 'ready'}>
          {loadState === 'loading' ? 'Loading lender data…' : 'Check My Options'}
        </button>
      </form>

      {results !== null && (
        <div style={{ marginTop: '30px' }}>
          {results.length === 0 ? (
            <div style={styles.errorBox}>
              <span>ⓘ</span> No lender partner matches this scenario yet. Try adjusting your inputs, or contact us directly.
            </div>
          ) : (
            <>
              <div style={styles.prequalSummary}>
                You qualify for: <strong>{uniqueLenderNames.join(', ')}</strong>
              </div>
              {results.map(r => (
                <div key={r.program.id} style={styles.prequalResultCard}>
                  <div style={styles.prequalResultHeader}>
                    <span style={styles.prequalResultLender}>{r.lender.name}</span>
                    <span style={styles.prequalResultProgram}>{r.program.loanType}</span>
                  </div>
                  <div>
                    {(r.program.docTypes || []).map(d => (
                      <span key={d} style={styles.prequalChip}>{d}</span>
                    ))}
                  </div>
                  <div style={styles.prequalResultDetails}>
                    {r.maxLtv && <span>Max LTV {r.maxLtv}%</span>}
                    {r.maxLoanAvail != null && <span>Est. max loan here: ${r.maxLoanAvail.toLocaleString()}</span>}
                  </div>
                  <button style={styles.prequalQuoteButton} onClick={() => onGetDetailedQuote(r.program, r.lender)}>
                    Get Detailed Quote
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * TERM SHEET DISPLAY
 */
const TermSheetDisplay = ({ termSheet, onBack }) => {
  const printableRef = useRef(null);
  const [selectedOptionId, setSelectedOptionId] = useState('balanced');
  const selectedOption = termSheet.quoteOptions.find(o => o.id === selectedOptionId) || termSheet.quoteOptions[1];
  const isCashout = termSheet.loanPurpose === 'cashout';

  const downloadPDF = () => {
    const namePart = (termSheet.borrowerName || 'Borrower').trim().replace(/\s+/g, '-');
    const datePart = new Date().toISOString().slice(0, 10);
    html2pdf().set({
      margin: 0.4,
      filename: `Loan-Estimate-${namePart}-${datePart}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    }).from(printableRef.current).save();
  };

  const printQuote = () => {
    window.print();
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

  const purposeLabels = {
    purchase: 'Purchase',
    refi: 'Refinance (Rate & Term)',
    cashout: 'Cash-Out Refinance'
  };

  const money = (v, opts = {}) => `$${parseFloat(v).toLocaleString('en-US', { maximumFractionDigits: 0, ...opts })}`;

  return (
    <div style={styles.termSheetContainer}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          #root, .term-sheet-printable, .term-sheet-printable * {
            color: #000 !important;
            background: #fff !important;
            box-shadow: none !important;
          }
          .term-sheet-printable { border: none !important; }
        }
        @page { size: letter; margin: 0.5in; }
      `}</style>

      <div ref={printableRef} className="term-sheet-printable">
        <div style={styles.letterheadHeader}>
          {termSheet.lenderName && <div style={styles.letterheadLender}>{termSheet.lenderName}</div>}
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
            {termSheet.lenderName && (
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Lender:</span>
                <span style={styles.infoValue}>{termSheet.lenderName}</span>
              </div>
            )}
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Loan Type / Purpose:</span>
              <span style={styles.infoValue}>
                {loanTypeNames[termSheet.product]}
                {purposeLabels[termSheet.loanPurpose] ? ` — ${purposeLabels[termSheet.loanPurpose]}` : ''}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Loan Amount:</span>
              <span style={styles.infoValue}>{money(termSheet.loanAmount)}</span>
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

        {/* Prominent selected-quote summary */}
        <div style={styles.selectedQuoteBox}>
          <div style={styles.selectedQuoteLabel}>Your Selected Quote — {selectedOption.label}</div>
          <div style={styles.selectedQuotePayment}>
            {money(selectedOption.monthlyPayment, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span style={{ fontSize: '18px', color: '#555', fontWeight: 'normal' }}> /mo</span>
          </div>
          <div style={styles.selectedQuoteMeta}>
            {selectedOption.rate}% Rate · {selectedOption.points} Point{selectedOption.points === 1 ? '' : 's'}
            {termSheet.paymentType === 'interestOnly' ? ' · Interest-Only' : ` · ${termSheet.loanTerm}-Year ${termSheet.paymentType}`}
          </div>
          {isCashout && (
            <div style={{ ...styles.selectedQuoteMeta, color: '#1E6F49', fontWeight: 'bold', fontSize: '16px' }}>
              Estimated Cash-Out: {money(selectedOption.cashOutAmount)}
            </div>
          )}
        </div>

        {/* Pricing */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Choose Your Rate Option</h2>
          <div style={styles.quoteOptionsGrid}>
            {termSheet.quoteOptions.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedOptionId(option.id)}
                style={{
                  ...styles.quoteOptionCard,
                  ...(option.id === selectedOptionId ? styles.quoteOptionCardSelected : {})
                }}
              >
                <div style={styles.quoteOptionLabel}>
                  {option.label}{option.id === selectedOptionId ? ' ✓ Selected' : ''}
                </div>
                <div style={styles.quoteOptionRate}>{option.rate}%</div>
                <div style={styles.quoteOptionRow}>
                  <span>Points:</span>
                  <span>{option.points} ({money(option.pointsCost)})</span>
                </div>
                <div style={styles.quoteOptionRow}>
                  <span>Monthly Payment:</span>
                  <span>{money(option.monthlyPayment, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {isCashout && (
                  <div style={styles.quoteOptionCashOut}>
                    <span>Est. Cash-Out:</span>
                    <span>{money(option.cashOutAmount)}</span>
                  </div>
                )}
                <div style={styles.pricingNote}>
                  {termSheet.paymentType === 'interestOnly' ? '(Interest-Only)' : `(${termSheet.loanTerm}-year ${termSheet.paymentType})`}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Cash-Out Details */}
        {isCashout && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Cash-Out Calculation</h2>
            <div style={styles.infoGrid}>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Current Loan Balance:</span>
                <span style={styles.infoValue}>{money(termSheet.currentBalance)}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>New Loan Amount:</span>
                <span style={styles.infoValue}>{money(termSheet.loanAmount)}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Est. Cash-Out ({selectedOption.label}):</span>
                <span style={styles.infoValue}>{money(selectedOption.cashOutAmount)}</span>
              </div>
            </div>
            <p style={styles.feeNote}>
              Formula: New Loan Amount − Current Loan Balance − Closing Costs (lender fees + points for the selected option) = Estimated Cash-Out.
            </p>
            <div style={styles.cashOutDisclaimerBox}>
{`IMPORTANT: Cash-out estimate does NOT include:
 • Title insurance
 • Escrow fees
 • Recording fees
 • Other third-party costs

Final cash-out may be lower after all costs are calculated.`}
            </div>
          </div>
        )}

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

        {/* Disclaimer + footer kept together so the footer never lands alone on its own page */}
        <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
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

          <div style={styles.termSheetFooter}>
            This is an automated estimate and has NOT been reviewed by a loan officer.
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={styles.actionButtons} className="no-print">
        <button onClick={() => window.location.href = '/apply'} style={styles.applyButton}>
          Apply Now & Lock in Your Rate
        </button>
        <button onClick={shareViaEmail} style={styles.secondaryButton}>📧 Share</button>
        <button onClick={downloadPDF} style={styles.secondaryButton}>⬇️ Download PDF</button>
        <button onClick={printQuote} style={styles.secondaryButton}>🖨️ Print Quote</button>
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

/**
 * PRE-QUALIFICATION (Lender Matrix / Supabase)
 */

const LENDER_MATRIX_SUPABASE_URL = 'https://olnxljyztebwfnjsqzbd.supabase.co';
const LENDER_MATRIX_SUPABASE_KEY = 'sb_publishable_fhpEMb9qE9_dU8MRCbB2KA_czs0_yPF';
const LENDER_MATRIX_STORE_KEY = 'lendermatrix:db';

const PREQUAL_PROP_TYPES = ['SFR', 'Condo', '2-4 Unit', 'Multifamily 5+', 'Mixed Use', 'Manufactured', 'Land'];
const PREQUAL_OCC_TYPES = ['Owner Occupied', 'Second Home', 'Investment'];
const PREQUAL_INCOME_TYPES = ['W-2 Employee', 'Self-Employed', '1099 Contractor', 'Retirement / Pension', 'Social Security', 'Rental Income', 'Investment / Dividend', 'Child Support / Alimony', 'Disability', 'Bonus / Commission'];
// States where the brokerage holds a license. Outside these, only investment
// loans through lenders that explicitly allow unlicensed states are eligible.
const PREQUAL_LICENSED_STATES = ['AZ', 'CA', 'CO', 'FL', 'ID', 'TX', 'TN'];
const PREQUAL_US_STATES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

function getDefaultPrequalForm() {
  return {
    purpose: 'purchase',
    propertyType: 'SFR',
    occupancy: 'Owner Occupied',
    incomeTypes: [],
    creditScore: '750',
    loanAmount: '',
    propertyValue: '',
    state: ''
  };
}

// Read-only fetch against the same Supabase project the internal Lender
// Matrix tool uses. This app never writes to it.
async function fetchLenderMatrix() {
  const res = await fetch(
    `${LENDER_MATRIX_SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(LENDER_MATRIX_STORE_KEY)}&select=value`,
    {
      headers: {
        apikey: LENDER_MATRIX_SUPABASE_KEY,
        Authorization: `Bearer ${LENDER_MATRIX_SUPABASE_KEY}`
      }
    }
  );
  if (!res.ok) throw new Error(`Lender matrix request failed (${res.status})`);
  const rows = await res.json();
  if (!rows.length) return { lenders: [], programs: [] };
  const parsed = JSON.parse(rows[0].value);
  return { lenders: parsed.lenders || [], programs: parsed.programs || [] };
}

// Maps a wholesale lender's program name (e.g. "Velvet Cake DSCR") onto one
// of this app's own internal calculator products. The Calculator keeps using
// its own rate sheets/margins regardless - this only pre-selects a sensible
// starting loan type.
function mapLoanTypeToProduct(loanType) {
  const s = (loanType || '').toLowerCase();
  if (s.includes('heloc')) return 'heloc';
  if (s.includes('closed-end second') || s.includes('closed end second') || s.includes('heloan')) return 'heloan';
  if (s.includes('fha')) return 'fha';
  if (/\bva\b/.test(s)) return 'va';
  if (s.includes('conventional') || s.includes('jumbo') || s.includes('usda')) return 'conventional';
  return 'nonQm';
}

function mapPrequalOccupancy(occupancy) {
  if (occupancy === 'Investment') return 'investment';
  if (occupancy === 'Second Home') return 'second_home';
  return 'primary';
}

// The Calculator's Property Type field only has 3 buckets (no manufactured/
// land/5+ unit options), so map onto the closest one.
function mapPrequalPropertyType(propertyType) {
  const map = {
    'SFR': 'single_family',
    'Condo': 'condo',
    '2-4 Unit': 'multi_unit',
    'Multifamily 5+': 'multi_unit',
    'Mixed Use': 'multi_unit'
  };
  return map[propertyType] || 'single_family';
}

// The Calculator's Non-QM doc type field predates DSCR being modeled
// separately, so an investment/DSCR scenario maps onto "Assets" (the
// closest existing bucket - qualification based on the deal, not personal
// income) rather than a dedicated DSCR option that doesn't exist there.
function derivePrequalDocType(incomeTypes, occupancy) {
  if (occupancy === 'Investment') return 'assets';
  if (incomeTypes.includes('Self-Employed')) return 'bank_statements';
  if (incomeTypes.includes('1099 Contractor')) return '1099s';
  if (incomeTypes.includes('Rental Income') || incomeTypes.includes('Investment / Dividend')) return 'assets';
  return 'bank_statements';
}

// The live lender matrix has inconsistent purpose labels across programs
// entered at different times ("Rate-Term" vs "R/T Refi", "Cash-Out" vs
// "Cash Out"), so match by keyword rather than exact string.
function purposeMatches(programPurposes, borrowerPurpose) {
  if (!programPurposes || !programPurposes.length) return true;
  const list = programPurposes.map(p => p.toLowerCase());
  if (borrowerPurpose === 'purchase') return list.some(p => p.includes('purchase'));
  if (borrowerPurpose === 'cashout') return list.some(p => p.includes('cash'));
  return list.some(p => p.includes('rate') || p.includes('r/t'));
}

// A borrower doesn't know lending jargon like "Full Doc" vs "Bank
// Statement" - they pick income sources instead, and we translate that into
// the doc/qualification types those sources would actually support.
function candidateDocTypes(incomeTypes, occupancy) {
  const docs = [];
  if (occupancy === 'Investment') docs.push('DSCR');
  if (incomeTypes.includes('Self-Employed')) docs.push('Bank Statement', 'P&L Only', 'Alt Doc');
  if (incomeTypes.includes('1099 Contractor')) docs.push('1099 Only');
  const wageLike = ['W-2 Employee', 'Retirement / Pension', 'Social Security', 'Disability', 'Child Support / Alimony', 'Bonus / Commission'];
  if (incomeTypes.some(i => wageLike.includes(i))) docs.push('Full Doc');
  if (incomeTypes.includes('Rental Income') || incomeTypes.includes('Investment / Dividend')) docs.push('Asset Depletion', 'Full Doc');
  if (!docs.length) docs.push('Full Doc');
  return [...new Set(docs)];
}

function docKeywordSetFor(candidates) {
  const map = {
    'DSCR': 'dscr',
    'Bank Statement': 'bank statement',
    'P&L Only': 'p&l',
    'Alt Doc': 'alt doc',
    '1099 Only': '1099',
    'Full Doc': 'full doc',
    'Asset Depletion': 'asset'
  };
  return new Set(candidates.map(c => map[c] || c.toLowerCase()));
}

// A program's own advertised doc-type list uses a looser vocabulary than the
// tier matrix (e.g. "Bank Statement (12-Month)", "1099" instead of "1099
// Only") - substring match against derived keywords instead of exact equality.
function docTypeMatches(programDocTypes, keywordSet) {
  if (!programDocTypes || !programDocTypes.length) return true;
  return programDocTypes.some(d => {
    const dl = d.toLowerCase();
    return [...keywordSet].some(k => dl.includes(k));
  });
}

// A program's matrix is rows of { fico (floor), doc, occ, lien, purpose,
// dscr (min DSCR floor), maxLtv, maxLoan }, each "" meaning "any". The
// applicable row: among rows matching the deal's doc/occupancy/lien/purpose,
// the one with the highest FICO (then DSCR) floor the deal meets, and within
// that band, the tightest LTV bracket the deal's LTV fits into.
function comboTiers(p, crit = {}) {
  return (p.tiers || [])
    .filter(t => t.fico !== '' && t.fico != null)
    .filter(t => !crit.occ || !t.occ || t.occ === crit.occ)
    .filter(t => !crit.lien || !t.lien || t.lien === crit.lien)
    // Tier rows use human-readable labels ("Purchase", "Rate-Term",
    // "Cash-Out") that don't line up 1:1 with our internal purpose values
    // ('purchase'/'refi'/'cashout') - match by keyword, not exact equality,
    // same as the top-level purposeMatches() check.
    .filter(t => !crit.purpose || !t.purpose || purposeMatches([t.purpose], crit.purpose))
    .filter(t => !crit.doc || !t.doc || t.doc === crit.doc)
    .sort((a, b) => (Number(b.fico) - Number(a.fico)) || (Number(b.dscr || 0) - Number(a.dscr || 0)));
}

function tierFor(p, crit = {}) {
  const anyTiers = (p.tiers || []).some(t => t.fico !== '' && t.fico != null);
  if (!anyTiers) return { hasTiers: false, tier: null, belowAll: false, noComboRows: false };
  const rows = comboTiers(p, crit);
  if (!rows.length) return { hasTiers: true, tier: null, belowAll: false, noComboRows: true };
  if (!crit.fico) return { hasTiers: true, tier: null, belowAll: false, noComboRows: false };

  const qualifies = rows.filter(x =>
    Number(crit.fico) >= Number(x.fico) &&
    (!crit.dscr || !x.dscr || Number(crit.dscr) >= Number(x.dscr))
  );
  if (!qualifies.length) return { hasTiers: true, tier: null, belowAll: true, noComboRows: false };

  const topFico = Math.max(...qualifies.map(x => Number(x.fico)));
  let band = qualifies.filter(x => Number(x.fico) === topFico);

  const metDscrFloors = band.filter(x => x.dscr).map(x => Number(x.dscr)).filter(v => !crit.dscr || Number(crit.dscr) >= v);
  if (crit.dscr && metDscrFloors.length) {
    const topDscr = Math.max(...metDscrFloors);
    band = band.filter(x => !x.dscr || Number(x.dscr) === topDscr);
  }

  if (crit.ltv) {
    const fits = band.filter(x => !x.maxLtv || Number(crit.ltv) <= Number(x.maxLtv));
    if (fits.length) {
      const chosen = fits.reduce((best, x) => {
        const bl = Number(best.maxLtv || Infinity), xl = Number(x.maxLtv || Infinity);
        if (xl < bl) return x;
        if (xl === bl && Number(x.maxLoan || 0) > Number(best.maxLoan || 0)) return x;
        return best;
      });
      return { hasTiers: true, tier: chosen, belowAll: false, noComboRows: false };
    }
    const loosest = band.reduce((best, x) => Number(x.maxLtv || 0) > Number(best.maxLtv || 0) ? x : best);
    return { hasTiers: true, tier: loosest, belowAll: false, noComboRows: false, ltvOver: true };
  }

  const bestCase = band.reduce((best, x) => Number(x.maxLoan || 0) > Number(best.maxLoan || 0) ? x : best);
  return { hasTiers: true, tier: bestCase, belowAll: false, noComboRows: false };
}

// Full eligibility check for one program against a borrower's pre-qual
// scenario. Returns null if disqualified, or a match summary otherwise.
// Unlike the internal loan-officer tool this is based on, there is no
// "near miss" coaching here - a public-facing tool either shows a program as
// qualifying or it doesn't.
function evaluatePrequalProgram(program, lender, crit) {
  if ((program.occTypes || []).length && !program.occTypes.includes(crit.occupancy)) return null;
  if (!purposeMatches(program.purposes, crit.purpose)) return null;
  // A program restricted to 2nd-lien only (e.g. a standalone HELOC or
  // closed-end second) can't be the sole loan on a purchase - it requires an
  // existing 1st mortgage already in place. Some of these have an empty
  // `purposes` array (meaning "unrestricted" everywhere else), which would
  // otherwise wrongly let them match a Purchase scenario.
  if (crit.purpose === 'purchase' && (program.liens || []).length && !program.liens.includes('1st')) return null;
  if ((program.propTypes || []).length && !program.propTypes.includes(crit.propertyType)) return null;

  const inUnlicensedState = crit.state && !PREQUAL_LICENSED_STATES.includes(crit.state);
  if (inUnlicensedState) {
    if (!lender.unlicensedStatesOk) return null;
    if (crit.occupancy !== 'Investment') return null;
  }
  if (crit.state && (lender.states || []).length && !lender.states.includes(crit.state)) return null;
  if (program.states && program.states.trim() && program.states.trim().toUpperCase() !== 'ALL') {
    const list = program.states.toUpperCase().split(/[,\s]+/).filter(Boolean);
    if (crit.state && !list.includes(crit.state)) return null;
  }

  const candidates = candidateDocTypes(crit.incomeTypes, crit.occupancy);
  if (!docTypeMatches(program.docTypes, docKeywordSetFor(candidates))) return null;

  const hasAnyTiers = (program.tiers || []).some(t => t.fico !== '' && t.fico != null);
  let chosenTier = null;
  let maxLoanAvail = null;

  if (hasAnyTiers) {
    let best = null;
    for (const doc of [...candidates, undefined]) {
      const r = tierFor(program, { fico: crit.fico, ltv: crit.ltv, doc, occ: crit.occupancy, purpose: crit.purpose });
      if (r.tier && !r.belowAll && !r.noComboRows) {
        const capByLtv = (crit.propertyValue && r.tier.maxLtv)
          ? Math.floor((Number(r.tier.maxLtv) / 100) * Number(crit.propertyValue))
          : null;
        const capByLoan = r.tier.maxLoan ? Number(r.tier.maxLoan) : null;
        const caps = [capByLtv, capByLoan].filter(v => v != null);
        const avail = caps.length ? Math.min(...caps) : null;
        if (!best || (avail || 0) > (best.avail || 0)) best = { tier: r.tier, avail };
      }
    }
    if (!best) return null;
    chosenTier = best.tier;
    maxLoanAvail = best.avail;
  }

  const effLtv = chosenTier?.maxLtv || program.maxLtv || null;
  const effMaxLoan = chosenTier?.maxLoan || program.maxLoan || null;

  if (crit.loanAmount) {
    const amt = Number(crit.loanAmount);
    if (program.minLoan && amt < Number(program.minLoan)) return null;
    if (effMaxLoan && amt > Number(effMaxLoan)) return null;
  }
  if (crit.ltv && effLtv && Number(crit.ltv) > Number(effLtv)) return null;

  return { program, lender, maxLtv: effLtv, maxLoan: effMaxLoan, maxLoanAvail };
}

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
  mainNav: {
    display: 'flex',
    justifyContent: 'center',
    gap: '4px',
    backgroundColor: '#1a1a1a',
    padding: '0 20px'
  },
  mainNavButton: {
    padding: '16px 24px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    color: '#aaa',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  mainNavButtonActive: {
    color: '#fff',
    borderBottom: '3px solid #0066cc'
  },
  prequalBanner: {
    backgroundColor: '#eaf2fe',
    border: '1px solid #b8d4f5',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '20px',
    color: '#1a4d8f',
    fontSize: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px'
  },
  prequalBannerDismiss: {
    background: 'none',
    border: 'none',
    color: '#1a4d8f',
    fontSize: '20px',
    lineHeight: '1',
    cursor: 'pointer',
    padding: '0 4px'
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
    breakInside: 'avoid',
    pageBreakInside: 'avoid',
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
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px'
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 220px',
    minWidth: '220px'
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
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px'
  },
  quoteOptionCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '20px',
    border: '2px solid #eee',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    breakInside: 'avoid',
    pageBreakInside: 'avoid',
    flex: '1 1 220px',
    minWidth: '220px',
    cursor: 'pointer',
    textAlign: 'left'
  },
  quoteOptionCardSelected: {
    border: '2px solid #0066cc',
    backgroundColor: '#f0f7ff'
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
  quoteOptionCashOut: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    fontWeight: 'bold',
    color: '#1E6F49',
    marginTop: '4px',
    paddingTop: '8px',
    borderTop: '1px dashed #ccc'
  },
  letterheadHeader: {
    textAlign: 'center',
    marginBottom: '10px'
  },
  letterheadLender: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1a1a1a',
    letterSpacing: '0.5px'
  },
  selectedQuoteBox: {
    backgroundColor: '#f0f7ff',
    border: '2px solid #0066cc',
    borderRadius: '10px',
    padding: '24px',
    textAlign: 'center',
    marginBottom: '20px',
    breakInside: 'avoid',
    pageBreakInside: 'avoid'
  },
  selectedQuoteLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px'
  },
  selectedQuotePayment: {
    fontSize: '44px',
    fontWeight: 'bold',
    color: '#0066cc',
    lineHeight: '1.1'
  },
  selectedQuoteMeta: {
    fontSize: '14px',
    color: '#333',
    marginTop: '8px'
  },
  cashOutDisclaimerBox: {
    backgroundColor: '#fff8e1',
    border: '1px solid #e0c068',
    borderRadius: '8px',
    padding: '16px',
    marginTop: '16px',
    color: '#5a4a28',
    fontSize: '13px',
    breakInside: 'avoid',
    pageBreakInside: 'avoid',
    lineHeight: '1.6',
    whiteSpace: 'pre-line'
  },
  termSheetFooter: {
    textAlign: 'center',
    fontSize: '12px',
    color: '#666',
    borderTop: '1px solid #ddd',
    paddingTop: '16px',
    marginTop: '10px'
  },
  prequalToggle: {
    display: 'inline-block',
    padding: '8px 14px',
    marginRight: '8px',
    marginBottom: '8px',
    borderRadius: '20px',
    border: '1px solid #ddd',
    backgroundColor: '#fff',
    color: '#333',
    fontSize: '13px',
    cursor: 'pointer'
  },
  prequalToggleActive: {
    backgroundColor: '#0066cc',
    borderColor: '#0066cc',
    color: '#fff'
  },
  prequalSummary: {
    backgroundColor: '#eaf2fe',
    border: '1px solid #b8d4f5',
    borderRadius: '8px',
    padding: '14px 16px',
    marginBottom: '16px',
    color: '#1a4d8f',
    fontSize: '15px'
  },
  prequalResultCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #eee',
    borderLeft: '4px solid #1E6F49',
    marginBottom: '14px'
  },
  prequalResultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '8px',
    flexWrap: 'wrap',
    gap: '6px'
  },
  prequalResultLender: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#1a1a1a'
  },
  prequalResultProgram: {
    fontSize: '13px',
    color: '#A87F2F'
  },
  prequalChip: {
    display: 'inline-block',
    fontSize: '12px',
    padding: '3px 8px',
    marginRight: '6px',
    marginTop: '6px',
    borderRadius: '4px',
    backgroundColor: '#E4F0E9',
    color: '#1E6F49'
  },
  prequalResultDetails: {
    display: 'flex',
    gap: '16px',
    fontSize: '13px',
    color: '#555',
    marginTop: '10px'
  },
  prequalQuoteButton: {
    marginTop: '12px',
    padding: '10px 18px',
    backgroundColor: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  feesBox: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '16px',
    border: '1px solid #eee',
    breakInside: 'avoid',
    pageBreakInside: 'avoid'
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
    lineHeight: '1.6',
    breakInside: 'avoid',
    pageBreakInside: 'avoid'
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
