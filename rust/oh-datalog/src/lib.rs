//! Positive-Datalog projection engine for Oh.
//!
//! This crate implements the same semantics as `oh`'s TypeScript projection
//! engine (`src/projection.ts`), but is designed to run without a JavaScript
//! heap. The API is intentionally small and additive: callers provide a dataset
//! of base facts, a rule pack, and a query; the engine materializes the
//! derivation and returns the bounded result.

use oh_canonical::{canonical_json_str, canonical_sha256_str};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};

/// A JSON primitive usable as a Datalog atom.
pub type OhProjectionAtom = Value;

/// A Datalog term: either a constant or a named variable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OhProjectionTerm {
    Constant { v: u8, value: OhProjectionAtom },
    Variable { name: String, v: u8 },
}

/// A relation name with a tuple of terms.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionLiteral {
    pub relation: String,
    pub terms: Vec<OhProjectionTerm>,
    pub v: u8,
}

/// A positive Datalog rule.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionRule {
    pub body: Vec<OhProjectionLiteral>,
    pub head: OhProjectionLiteral,
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    #[serde(rename = "ruleSha256")]
    pub rule_sha256: String,
    pub v: u8,
}

/// A source record reference for a base fact.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionFactSource {
    pub key: String,
    #[serde(rename = "recordSha256")]
    pub record_sha256: String,
    pub v: u8,
}

/// A base fact with provenance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionFact {
    #[serde(rename = "factSha256")]
    pub fact_sha256: String,
    pub relation: String,
    pub sources: Vec<OhProjectionFactSource>,
    pub tuple: Vec<OhProjectionAtom>,
    pub v: u8,
}

/// A complete dataset with provenance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionDataset {
    #[serde(rename = "datasetSha256")]
    pub dataset_sha256: String,
    #[serde(rename = "extractorSha256")]
    pub extractor_sha256: String,
    #[serde(rename = "factPackId")]
    pub fact_pack_id: String,
    #[serde(rename = "factPackRevision")]
    pub fact_pack_revision: u64,
    #[serde(rename = "factPackSha256")]
    pub fact_pack_sha256: String,
    pub facts: Vec<OhProjectionFact>,
    #[serde(rename = "factsSha256")]
    pub facts_sha256: String,
    #[serde(rename = "snapshotSha256")]
    pub snapshot_sha256: String,
    pub v: u8,
}

/// A rule pack with provenance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionRulePack {
    #[serde(rename = "rulePackId")]
    pub rule_pack_id: String,
    #[serde(rename = "rulePackRevision")]
    pub rule_pack_revision: u64,
    #[serde(rename = "rulePackSha256")]
    pub rule_pack_sha256: String,
    pub rules: Vec<OhProjectionRule>,
    #[serde(rename = "rulesSha256")]
    pub rules_sha256: String,
    pub semantics: String,
    pub v: u8,
}

/// A query with provenance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionQuery {
    pub find: Vec<String>,
    pub limit: u64,
    #[serde(rename = "queryId")]
    pub query_id: String,
    #[serde(rename = "querySha256")]
    pub query_sha256: String,
    pub where_: Vec<OhProjectionLiteral>,
    pub v: u8,
}

/// A proof node for a derived tuple.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OhProjectionProof {
    Fact {
        relation: String,
        sources: Vec<OhProjectionFactSource>,
        tuple: Vec<OhProjectionAtom>,
        v: u8,
    },
    Derived {
        premises: Vec<OhProjectionProof>,
        #[serde(rename = "premisesTruncated")]
        premises_truncated: bool,
        relation: String,
        #[serde(rename = "ruleId")]
        rule_id: String,
        #[serde(rename = "ruleSha256")]
        rule_sha256: String,
        tuple: Vec<OhProjectionAtom>,
        v: u8,
    },
    Truncated {
        reason: String,
        relation: String,
        tuple: Vec<OhProjectionAtom>,
        v: u8,
    },
}

/// A single result row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OhProjectionResultRow {
    pub proofs: Vec<OhProjectionProof>,
    #[serde(rename = "proofsTruncated")]
    pub proofs_truncated: bool,
    #[serde(rename = "supportCount")]
    pub support_count: u64,
    pub values: Vec<OhProjectionAtom>,
    pub v: u8,
}

/// The complete projection result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OhProjectionResult {
    pub authority: String,
    pub cache: CacheInfo,
    pub engine: String,
    pub evaluation: EvaluationLimits,
    pub facts: FactCounts,
    pub output: ResultRows,
    pub provenance: Provenance,
    pub query: QuerySummary,
    pub semantics: String,
    pub v: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheInfo {
    pub strategy: String,
    pub v: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationLimits {
    #[serde(rename = "maximumDerivedTuples")]
    pub maximum_derived_tuples: u64,
    #[serde(rename = "maximumProofDepth")]
    pub maximum_proof_depth: u64,
    #[serde(rename = "maximumProofNodes")]
    pub maximum_proof_nodes: u64,
    #[serde(rename = "maximumResultBytes")]
    pub maximum_result_bytes: u64,
    #[serde(rename = "maximumRounds")]
    pub maximum_rounds: u64,
    #[serde(rename = "maximumTotalProofNodes")]
    pub maximum_total_proof_nodes: u64,
    #[serde(rename = "maximumWorkUnits")]
    pub maximum_work_units: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactCounts {
    pub base: u64,
    pub derived: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultRows {
    pub rows: Vec<OhProjectionResultRow>,
    #[serde(rename = "rowsTruncated")]
    pub rows_truncated: bool,
    #[serde(rename = "rowsTotal")]
    pub rows_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    pub contract: ContractInfo,
    #[serde(rename = "datasetSha256")]
    pub dataset_sha256: String,
    #[serde(rename = "engineSha256")]
    pub engine_sha256: String,
    #[serde(rename = "evaluationSha256")]
    pub evaluation_sha256: String,
    #[serde(rename = "querySha256")]
    pub query_sha256: String,
    #[serde(rename = "rulePackSha256")]
    pub rule_pack_sha256: String,
    #[serde(rename = "snapshotSha256")]
    pub snapshot_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractInfo {
    #[serde(rename = "contractSha256")]
    pub contract_sha256: String,
    pub v: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuerySummary {
    pub find: Vec<String>,
    #[serde(rename = "queryId")]
    pub query_id: String,
    #[serde(rename = "querySha256")]
    pub query_sha256: String,
    pub v: u8,
}

/// Errors from projection evaluation.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum ProjectionError {
    InvalidInput { message: String },
    WorkBudgetExceeded { limit: u64 },
    DerivedTupleLimitExceeded { limit: u64 },
    RoundLimitExceeded { limit: u64 },
    MatchLimitExceeded { limit: u64 },
    ResultByteLimitExceeded { limit: u64 },
    ProofNodeLimitExceeded { limit: u64 },
    ProofDepthLimitExceeded { limit: u64 },
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for ProjectionError {}

/// Work budget shared across the materialization.
#[derive(Debug, Clone)]
pub struct WorkBudget {
    maximum: u64,
    units: u64,
}

impl WorkBudget {
    pub fn new(maximum: u64) -> Self {
        Self { maximum, units: 0 }
    }

    pub fn consume(&mut self) -> Result<(), ProjectionError> {
        if self.units >= self.maximum {
            return Err(ProjectionError::WorkBudgetExceeded { limit: self.maximum });
        }
        self.units += 1;
        Ok(())
    }
}

type Binding = HashMap<String, OhProjectionAtom>;
type TupleKey = String;

#[derive(Debug, Clone)]
struct TupleState {
    tuple: Vec<OhProjectionAtom>,
    witness: Witness,
}

#[derive(Debug, Clone)]
enum Witness {
    Fact { sources: Vec<OhProjectionFactSource> },
    Derived { premises: Vec<TupleReference>, rule: OhProjectionRule },
}

#[derive(Debug, Clone, Serialize)]
struct TupleReference {
    relation: String,
    tuple: Vec<OhProjectionAtom>,
}

fn tuple_key(tuple: &[OhProjectionAtom]) -> TupleKey {
    canonical_json_str(&serde_json::to_string(tuple).unwrap())
        .unwrap_or_else(|_| "[]".to_string())
}

fn reference_key(reference: &TupleReference) -> String {
    canonical_json_str(&serde_json::to_string(&[
        Value::String(reference.relation.clone()),
        Value::Array(reference.tuple.clone()),
    ]).unwrap()).unwrap_or_else(|_| "[]".to_string())
}

fn canonical_witness(witness: &Witness) -> String {
    match witness {
        Witness::Fact { sources } => {
            canonical_json_str(&serde_json::to_string(&serde_json::json!({
                "kind": "fact",
                "sources": sources,
            })).unwrap()).unwrap_or_else(|_| "{}".to_string())
        }
        Witness::Derived { premises, rule } => {
            canonical_json_str(&serde_json::to_string(&serde_json::json!({
                "kind": "derived",
                "premises": premises,
                "ruleSha256": rule.rule_sha256,
            })).unwrap()).unwrap_or_else(|_| "{}".to_string())
        }
    }
}

fn same_atom(left: &OhProjectionAtom, right: &OhProjectionAtom) -> bool {
    left == right
}

fn unify_literal(literal: &OhProjectionLiteral, state: &TupleState, binding: &Binding) -> Option<Binding> {
    let mut next = binding.clone();
    for (index, term) in literal.terms.iter().enumerate() {
        let value = &state.tuple[index];
        match term {
            OhProjectionTerm::Constant { value: const_value, .. } => {
                if !same_atom(const_value, value) {
                    return None;
                }
            }
            OhProjectionTerm::Variable { name, .. } => {
                if let Some(existing) = next.get(name) {
                    if !same_atom(existing, value) {
                        return None;
                    }
                } else {
                    next.insert(name.clone(), value.clone());
                }
            }
        }
    }
    Some(next)
}

fn match_body(
    relations: &BTreeMap<String, BTreeMap<TupleKey, TupleState>>,
    body: &[OhProjectionLiteral],
    maximum_matches: u64,
    work: &mut WorkBudget,
) -> Result<Vec<BodyMatch>, ProjectionError> {
    let mut matches: Vec<BodyMatch> = vec![BodyMatch { binding: Binding::new(), premises: Vec::new() }];
    for literal in body {
        let candidates = relations
            .get(&literal.relation)
            .map(|m| m.values().collect::<Vec<_>>())
            .unwrap_or_default();
        let mut next: Vec<BodyMatch> = Vec::new();
        for match_ in matches {
            for candidate in &candidates {
                work.consume()?;
                if let Some(binding) = unify_literal(literal, candidate, &match_.binding) {
                    next.push(BodyMatch {
                        binding,
                        premises: {
                            let mut p = match_.premises.clone();
                            p.push(TupleReference {
                                relation: literal.relation.clone(),
                                tuple: candidate.tuple.clone(),
                            });
                            p
                        },
                    });
                    if next.len() as u64 > maximum_matches {
                        return Err(ProjectionError::MatchLimitExceeded { limit: maximum_matches });
                    }
                }
            }
        }
        matches = next;
        if matches.is_empty() {
            break;
        }
    }
    Ok(matches)
}

struct BodyMatch {
    binding: Binding,
    premises: Vec<TupleReference>,
}

fn instantiate_head(head: &OhProjectionLiteral, binding: &Binding) -> Vec<OhProjectionAtom> {
    head.terms
        .iter()
        .map(|term| match term {
            OhProjectionTerm::Constant { value, .. } => value.clone(),
            OhProjectionTerm::Variable { name, .. } => binding.get(name).cloned().unwrap_or(Value::Null),
        })
        .collect()
}

fn materialize_naive(
    dataset: &OhProjectionDataset,
    rule_pack: &OhProjectionRulePack,
    maximum_derived_tuples: u64,
    maximum_rounds: u64,
    work: &mut WorkBudget,
) -> Result<MaterializedProjection, ProjectionError> {
    let mut relations: BTreeMap<String, BTreeMap<TupleKey, TupleState>> = BTreeMap::new();
    for fact in &dataset.facts {
        relations
            .entry(fact.relation.clone())
            .or_default()
            .insert(tuple_key(&fact.tuple), TupleState {
                tuple: fact.tuple.clone(),
                witness: Witness::Fact { sources: fact.sources.clone() },
            });
    }

    let mut derived_facts = 0u64;
    let mut rounds = 0u64;

    loop {
        let mut candidates: BTreeMap<String, (String, TupleState)> = BTreeMap::new();
        for rule in &rule_pack.rules {
            for match_ in match_body(&relations, &rule.body, u64::MAX, work)? {
                let derived_tuple = instantiate_head(&rule.head, &match_.binding);
                let key = tuple_key(&derived_tuple);
                if relations
                    .get(&rule.head.relation)
                    .map(|m| m.contains_key(&key))
                    .unwrap_or(false)
                {
                    continue;
                }
                let state = TupleState {
                    tuple: derived_tuple.clone(),
                    witness: Witness::Derived {
                        premises: match_.premises.clone(),
                        rule: rule.clone(),
                    },
                };
                let identity = reference_key(&TupleReference {
                    relation: rule.head.relation.clone(),
                    tuple: derived_tuple.clone(),
                });
                match candidates.get(&identity) {
                    Some((_, existing_state)) if canonical_witness(&state.witness) >= canonical_witness(&existing_state.witness) => {
                        continue;
                    }
                    _ => {
                        candidates.insert(identity, (rule.head.relation.clone(), state));
                    }
                }
            }
        }
        if candidates.is_empty() {
            break;
        }
        if rounds >= maximum_rounds {
            return Err(ProjectionError::RoundLimitExceeded { limit: maximum_rounds });
        }
        let candidates_len = candidates.len() as u64;
        if derived_facts + candidates_len > maximum_derived_tuples {
            return Err(ProjectionError::DerivedTupleLimitExceeded { limit: maximum_derived_tuples });
        }
        for (_, (relation, state)) in candidates {
            relations
                .entry(relation)
                .or_default()
                .insert(tuple_key(&state.tuple), state);
        }
        derived_facts += candidates_len;
        rounds += 1;
    }

    Ok(MaterializedProjection {
        base_facts: dataset.facts.len() as u64,
        derived_facts,
        relations,
        rounds,
    })
}

struct MaterializedProjection {
    base_facts: u64,
    derived_facts: u64,
    relations: BTreeMap<String, BTreeMap<TupleKey, TupleState>>,
    #[allow(dead_code)]
    rounds: u64,
}

/// Evaluation options controlling projection limits.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct OhProjectionEvaluationOptions {
    #[serde(rename = "maximumDerivedTuples")]
    pub maximum_derived_tuples: Option<u64>,
    #[serde(rename = "maximumProofDepth")]
    pub maximum_proof_depth: Option<u64>,
    #[serde(rename = "maximumProofNodes")]
    pub maximum_proof_nodes: Option<u64>,
    #[serde(rename = "maximumResultBytes")]
    pub maximum_result_bytes: Option<u64>,
    #[serde(rename = "maximumRounds")]
    pub maximum_rounds: Option<u64>,
    #[serde(rename = "maximumTotalProofNodes")]
    pub maximum_total_proof_nodes: Option<u64>,
    #[serde(rename = "maximumWorkUnits")]
    pub maximum_work_units: Option<u64>,
}

fn bounded_option(value: Option<u64>, fallback: u64, maximum: u64) -> Result<u64, ProjectionError> {
    let value = value.unwrap_or(fallback);
    if value == 0 || value > maximum {
        return Err(ProjectionError::InvalidInput {
            message: format!("limit must be an integer from 1 through {maximum}"),
        });
    }
    Ok(value)
}

const LIMITS: Limits = Limits {
    arity: 32,
    atom_bytes: 16 * 1024,
    derived_tuples: 262_144,
    facts: 262_144,
    literals_per_rule: 64,
    proof_depth: 128,
    proof_nodes: 4_096,
    query_literals: 64,
    query_matches: 262_144,
    query_results: 65_536,
    relations: 4_096,
    result_bytes: 16 * 1024 * 1024,
    rounds: 1_024,
    rules: 1_024,
    sources_per_fact: 64,
    total_proof_nodes: 65_536,
    variables: 256,
    work_units: 16_777_216,
};

#[allow(dead_code)]
struct Limits {
    arity: u64,
    atom_bytes: u64,
    derived_tuples: u64,
    facts: u64,
    literals_per_rule: u64,
    proof_depth: u64,
    proof_nodes: u64,
    query_literals: u64,
    query_matches: u64,
    query_results: u64,
    relations: u64,
    result_bytes: u64,
    rounds: u64,
    rules: u64,
    sources_per_fact: u64,
    total_proof_nodes: u64,
    variables: u64,
    work_units: u64,
}

fn resolve_evaluation_options(options: OhProjectionEvaluationOptions) -> Result<EvaluationLimits, ProjectionError> {
    Ok(EvaluationLimits {
        maximum_derived_tuples: bounded_option(
            options.maximum_derived_tuples,
            LIMITS.derived_tuples,
            LIMITS.derived_tuples,
        )?,
        maximum_proof_depth: bounded_option(
            options.maximum_proof_depth,
            32,
            LIMITS.proof_depth,
        )?,
        maximum_proof_nodes: bounded_option(
            options.maximum_proof_nodes,
            1_024,
            LIMITS.proof_nodes,
        )?,
        maximum_result_bytes: bounded_option(
            options.maximum_result_bytes,
            LIMITS.result_bytes,
            LIMITS.result_bytes,
        )?,
        maximum_rounds: bounded_option(
            options.maximum_rounds,
            LIMITS.rounds,
            LIMITS.rounds,
        )?,
        maximum_total_proof_nodes: bounded_option(
            options.maximum_total_proof_nodes,
            LIMITS.total_proof_nodes,
            LIMITS.total_proof_nodes,
        )?,
        maximum_work_units: bounded_option(
            options.maximum_work_units,
            LIMITS.work_units,
            LIMITS.work_units,
        )?,
    })
}

struct ResultBudget {
    bytes: u64,
    maximum_bytes: u64,
    nodes: u64,
}

impl ResultBudget {
    fn reserve_bytes(&mut self, value: &Value) -> bool {
        let bytes = serde_json::to_string(value).map(|s| s.len() as u64).unwrap_or(0);
        if self.bytes + bytes > self.maximum_bytes {
            return false;
        }
        self.bytes += bytes;
        true
    }
}

struct ProofBudget<'a> {
    nodes: u64,
    result: &'a mut ResultBudget,
    options: &'a EvaluationLimits,
}

impl ProofBudget<'_> {
    fn reserve_node(&mut self, envelope: &OhProjectionProof) -> bool {
        if self.nodes >= self.options.maximum_proof_nodes
            || self.result.nodes >= self.options.maximum_total_proof_nodes
            || !self.result.reserve_bytes(&serde_json::to_value(envelope).unwrap())
        {
            return false;
        }
        self.nodes += 1;
        self.result.nodes += 1;
        true
    }
}

fn proof_for_reference(
    relations: &BTreeMap<String, BTreeMap<TupleKey, TupleState>>,
    reference: &TupleReference,
    budget: &mut ProofBudget,
    options: &EvaluationLimits,
    depth: u64,
    visiting: &mut HashSet<String>,
) -> Option<OhProjectionProof> {
    if depth >= options.maximum_proof_depth {
        let proof = OhProjectionProof::Truncated {
            reason: "depth".to_string(),
            relation: reference.relation.clone(),
            tuple: reference.tuple.clone(),
            v: 1,
        };
        return if budget.reserve_node(&proof) { Some(proof) } else { None };
    }
    let identity = reference_key(reference);
    if visiting.contains(&identity) {
        let proof = OhProjectionProof::Truncated {
            reason: "cycle".to_string(),
            relation: reference.relation.clone(),
            tuple: reference.tuple.clone(),
            v: 1,
        };
        return if budget.reserve_node(&proof) { Some(proof) } else { None };
    }
    let state = relations
        .get(&reference.relation)
        .and_then(|m| m.get(&tuple_key(&reference.tuple)))?;
    match &state.witness {
        Witness::Fact { sources } => {
            let proof = OhProjectionProof::Fact {
                relation: reference.relation.clone(),
                sources: sources.clone(),
                tuple: reference.tuple.clone(),
                v: 1,
            };
            if budget.reserve_node(&proof) { Some(proof) } else { None }
        }
        Witness::Derived { premises, rule } => {
            let envelope = OhProjectionProof::Derived {
                premises: Vec::new(),
                premises_truncated: false,
                relation: reference.relation.clone(),
                rule_id: rule.rule_id.clone(),
                rule_sha256: rule.rule_sha256.clone(),
                tuple: reference.tuple.clone(),
                v: 1,
            };
            if !budget.reserve_node(&envelope) {
                return None;
            }
            visiting.insert(identity.clone());
            let mut premises_proofs = Vec::new();
            let mut premises_truncated = false;
            for premise in premises {
                match proof_for_reference(relations, premise, budget, options, depth + 1, visiting) {
                    Some(proof) => premises_proofs.push(proof),
                    None => {
                        premises_truncated = true;
                        break;
                    }
                }
            }
            visiting.remove(&identity);
            if premises_truncated {
                Some(OhProjectionProof::Truncated {
                    reason: "nodes".to_string(),
                    relation: reference.relation.clone(),
                    tuple: reference.tuple.clone(),
                    v: 1,
                })
            } else {
                Some(OhProjectionProof::Derived {
                    premises: premises_proofs,
                    premises_truncated: false,
                    relation: reference.relation.clone(),
                    rule_id: rule.rule_id.clone(),
                    rule_sha256: rule.rule_sha256.clone(),
                    tuple: reference.tuple.clone(),
                    v: 1,
                })
            }
        }
    }
}

/// Evaluate a positive-Datalog projection.
pub fn evaluate_projection(
    dataset: &OhProjectionDataset,
    rule_pack: &OhProjectionRulePack,
    query: &OhProjectionQuery,
    options: OhProjectionEvaluationOptions,
) -> Result<OhProjectionResult, ProjectionError> {
    let options = resolve_evaluation_options(options)?;
    let mut work = WorkBudget::new(options.maximum_work_units);

    let materialized = materialize_naive(
        dataset,
        rule_pack,
        options.maximum_derived_tuples,
        options.maximum_rounds,
        &mut work,
    )?;

    let mut result_budget = ResultBudget {
        bytes: 0,
        maximum_bytes: options.maximum_result_bytes,
        nodes: 0,
    };
    let mut rows = Vec::new();
    let mut rows_truncated = false;

    let matches = match_body(
        &materialized.relations,
        &query.where_,
        LIMITS.query_matches,
        &mut work,
    )?;
    for match_ in matches {
        let values = query
            .find
            .iter()
            .map(|name| match_.binding.get(name).cloned().unwrap_or(Value::Null))
            .collect::<Vec<_>>();

        let mut proof_budget = ProofBudget {
            nodes: 0,
            result: &mut result_budget,
            options: &options,
        };
        let mut visiting = HashSet::new();
        let proofs = match_
            .premises
            .iter()
            .map(|reference| {
                proof_for_reference(
                    &materialized.relations,
                    reference,
                    &mut proof_budget,
                    &options,
                    0,
                    &mut visiting,
                )
            })
            .collect::<Option<Vec<_>>>();

        let proofs_truncated = proofs.is_none();
        let row = OhProjectionResultRow {
            proofs: proofs.unwrap_or_default(),
            proofs_truncated,
            support_count: 1,
            values,
            v: 1,
        };

        if rows.len() as u64 >= LIMITS.query_results {
            rows_truncated = true;
            break;
        }
        rows.push(row);
    }

    let rows_total = rows.len() as u64;

    let provenance = Provenance {
        contract: ContractInfo {
            contract_sha256: "oh.contract-manifest.v1".to_string(),
            v: 1,
        },
        dataset_sha256: dataset.dataset_sha256.clone(),
        engine_sha256: "oh-datalog.rust.v1".to_string(),
        evaluation_sha256: canonical_sha256_str(&serde_json::to_string(&serde_json::json!({
            "maximumDerivedTuples": options.maximum_derived_tuples,
            "maximumProofDepth": options.maximum_proof_depth,
            "maximumProofNodes": options.maximum_proof_nodes,
            "maximumResultBytes": options.maximum_result_bytes,
            "maximumRounds": options.maximum_rounds,
            "maximumTotalProofNodes": options.maximum_total_proof_nodes,
            "maximumWorkUnits": options.maximum_work_units,
        })).unwrap()).unwrap_or_default(),
        query_sha256: query.query_sha256.clone(),
        rule_pack_sha256: rule_pack.rule_pack_sha256.clone(),
        snapshot_sha256: dataset.snapshot_sha256.clone(),
    };

    Ok(OhProjectionResult {
        authority: "derived".to_string(),
        cache: CacheInfo {
            strategy: "full-rebuild".to_string(),
            v: 1,
        },
        engine: "oh.projection.rust.v1".to_string(),
        evaluation: options,
        facts: FactCounts {
            base: materialized.base_facts,
            derived: materialized.derived_facts,
        },
        output: ResultRows {
            rows,
            rows_truncated,
            rows_total,
        },
        provenance,
        query: QuerySummary {
            find: query.find.clone(),
            query_id: query.query_id.clone(),
            query_sha256: query.query_sha256.clone(),
            v: 1,
        },
        semantics: "oh.projection.positive-datalog.v1".to_string(),
        v: 1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atom(value: &str) -> OhProjectionAtom {
        Value::String(value.to_string())
    }

    #[allow(dead_code)]
    fn constant(value: &str) -> OhProjectionTerm {
        OhProjectionTerm::Constant { v: 1, value: atom(value) }
    }

    fn variable(name: &str) -> OhProjectionTerm {
        OhProjectionTerm::Variable { name: name.to_string(), v: 1 }
    }

    fn literal(relation: &str, terms: Vec<OhProjectionTerm>) -> OhProjectionLiteral {
        OhProjectionLiteral {
            relation: relation.to_string(),
            terms,
            v: 1,
        }
    }

    fn fact(relation: &str, tuple: Vec<&str>, sources: Vec<(&str, &str)>) -> OhProjectionFact {
        let sources = sources
            .into_iter()
            .map(|(key, record_sha256)| OhProjectionFactSource {
                key: key.to_string(),
                record_sha256: record_sha256.to_string(),
                v: 1,
            })
            .collect();
        let tuple = tuple.into_iter().map(atom).collect();
        let payload = serde_json::json!({
            "relation": relation,
            "sources": sources,
            "tuple": tuple,
            "v": 1,
        });
        let fact_sha256 = canonical_sha256_str(&payload.to_string()).unwrap();
        OhProjectionFact {
            fact_sha256,
            relation: relation.to_string(),
            sources,
            tuple,
            v: 1,
        }
    }

    fn rule(id: &str, body: Vec<OhProjectionLiteral>, head: OhProjectionLiteral) -> OhProjectionRule {
        let payload = serde_json::json!({
            "body": body,
            "head": head,
            "ruleId": id,
            "v": 1,
        });
        let rule_sha256 = canonical_sha256_str(&payload.to_string()).unwrap();
        OhProjectionRule {
            body,
            head,
            rule_id: id.to_string(),
            rule_sha256,
            v: 1,
        }
    }

    fn dataset(facts: Vec<OhProjectionFact>) -> OhProjectionDataset {
        let extractor_sha256 = canonical_sha256_str(r#"{"factPackId":"test","v":1}"#).unwrap();
        let fact_pack_sha256 = canonical_sha256_str(r#"{"factPackId":"test","v":1}"#).unwrap();
        let facts_sha256 = canonical_sha256_str(&serde_json::to_string(&facts).unwrap()).unwrap();
        let snapshot_sha256 = canonical_sha256_str(r#"{"v":1}"#).unwrap();
        let payload = serde_json::json!({
            "extractorSha256": extractor_sha256,
            "factPackId": "test",
            "factPackRevision": 1,
            "factPackSha256": fact_pack_sha256,
            "facts": facts,
            "factsSha256": facts_sha256,
            "snapshotSha256": snapshot_sha256,
            "v": 1,
        });
        let dataset_sha256 = canonical_sha256_str(&payload.to_string()).unwrap();
        OhProjectionDataset {
            dataset_sha256,
            extractor_sha256,
            fact_pack_id: "test".to_string(),
            fact_pack_revision: 1,
            fact_pack_sha256,
            facts,
            facts_sha256,
            snapshot_sha256,
            v: 1,
        }
    }

    fn rule_pack(rules: Vec<OhProjectionRule>) -> OhProjectionRulePack {
        let rules_sha256 = canonical_sha256_str(&serde_json::to_string(&rules).unwrap()).unwrap();
        let payload = serde_json::json!({
            "rulePackId": "test",
            "rulePackRevision": 1,
            "rulePackSha256": "x",
            "rules": rules,
            "rulesSha256": rules_sha256,
            "semantics": "oh.projection.positive-datalog.v1",
            "v": 1,
        });
        let rule_pack_sha256 = canonical_sha256_str(&payload.to_string()).unwrap();
        OhProjectionRulePack {
            rule_pack_id: "test".to_string(),
            rule_pack_revision: 1,
            rule_pack_sha256,
            rules,
            rules_sha256,
            semantics: "oh.projection.positive-datalog.v1".to_string(),
            v: 1,
        }
    }

    fn query(where_: Vec<OhProjectionLiteral>, find: Vec<&str>) -> OhProjectionQuery {
        let query_sha256 = canonical_sha256_str(&serde_json::json!({
            "find": find,
            "limit": 100,
            "queryId": "test",
            "where": where_,
            "v": 1,
        }).to_string()).unwrap();
        OhProjectionQuery {
            find: find.into_iter().map(|s| s.to_string()).collect(),
            limit: 100,
            query_id: "test".to_string(),
            query_sha256,
            where_,
            v: 1,
        }
    }

    #[test]
    fn derives_transitive_closure() {
        let dataset = dataset(vec![
            fact("edge", vec!["a", "b"], vec![("s1", "sha1")]),
            fact("edge", vec!["b", "c"], vec![("s2", "sha2")]),
            fact("edge", vec!["c", "d"], vec![("s3", "sha3")]),
        ]);
        let rules = rule_pack(vec![
            rule(
                "path-direct",
                vec![literal("edge", vec![variable("x"), variable("y")])],
                literal("path", vec![variable("x"), variable("y")]),
            ),
            rule(
                "path-indirect",
                vec![
                    literal("edge", vec![variable("x"), variable("z")]),
                    literal("path", vec![variable("z"), variable("y")]),
                ],
                literal("path", vec![variable("x"), variable("y")]),
            ),
        ]);
        let query = query(
            vec![literal("path", vec![variable("x"), variable("y")])],
            vec!["x", "y"],
        );

        let result = evaluate_projection(&dataset, &rules, &query, OhProjectionEvaluationOptions {
            maximum_derived_tuples: None,
            maximum_proof_depth: None,
            maximum_proof_nodes: None,
            maximum_result_bytes: None,
            maximum_rounds: None,
            maximum_total_proof_nodes: None,
            maximum_work_units: None,
        }).unwrap();

        assert_eq!(result.facts.derived, 6); // a->b, a->c, a->d, b->c, b->d, c->d
        assert_eq!(result.output.rows.len(), 6);
    }

    #[test]
    fn enforces_work_unit_budget() {
        let dataset = dataset(vec![
            fact("edge", vec!["a", "b"], vec![("s1", "sha1")]),
            fact("edge", vec!["b", "c"], vec![("s2", "sha2")]),
        ]);
        let rules = rule_pack(vec![rule(
            "path",
            vec![literal("edge", vec![variable("x"), variable("y")])],
            literal("path", vec![variable("x"), variable("y")]),
        )]);
        let query = query(
            vec![literal("path", vec![variable("x"), variable("y")])],
            vec!["x", "y"],
        );

        let result = evaluate_projection(&dataset, &rules, &query, OhProjectionEvaluationOptions {
            maximum_work_units: Some(1),
            ..Default::default()
        });

        assert!(matches!(result, Err(ProjectionError::WorkBudgetExceeded { .. })));
    }
}
