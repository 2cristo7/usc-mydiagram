-- S10.3 — Purga de diagramas de tipos retirados del catálogo (uml_class, state_machine).
-- Datos de desarrollo; se eliminan al retirar esos tipos del producto. El catálogo
-- final es: erd, sequence, flowchart, architecture, mindmap, use_case.

delete from public.diagrams
where diagram_type in ('uml_class', 'state_machine');
