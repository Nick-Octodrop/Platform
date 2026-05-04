from app.conditions import eval_condition
from app.main import _build_simple_domain_sql_clause


def test_simple_domain_maps_entity_qualified_id_to_record_id_column():
    sql, params = _build_simple_domain_sql_clause(
        {"op": "eq", "field": "biz_contact.id", "value": "company-1"},
        entity_id="entity.biz_contact",
    )

    assert sql == "id = %s"
    assert params == ["company-1"]


def test_condition_eval_resolves_entity_qualified_candidate_id():
    assert eval_condition(
        {"op": "eq", "field": "biz_contact.id", "value": "company-1"},
        {"candidate": {"id": "company-1"}},
    )

